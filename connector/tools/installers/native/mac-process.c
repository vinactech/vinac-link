// macOS lifecycle evidence and kernel-owned launch lock. No privileges, keys or HTTP.
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <time.h>

static void quoted(const char *s) {
  putchar('"'); for (const unsigned char *p=(const unsigned char*)s;*p;p++) {
    if (*p=='"'||*p=='\\') { putchar('\\');putchar(*p); }
    else if (*p<32) printf("\\u%04x",*p); else putchar(*p);
  } putchar('"');
}
static bool bsd(pid_t pid, struct proc_bsdinfo *b) {
  memset(b,0,sizeof(*b)); return proc_pidinfo(pid,PROC_PIDTBSDINFO,0,b,sizeof(*b))==sizeof(*b);
}
static bool owns_port(pid_t pid,int port) {
  int n=proc_pidinfo(pid,PROC_PIDLISTFDS,0,NULL,0);
  if (n<=0 || n>2*1024*1024) return false;
  struct proc_fdinfo *fds=calloc(1,(size_t)n); if(!fds)return false;
  int used=proc_pidinfo(pid,PROC_PIDLISTFDS,0,fds,n);bool found=false;
  for(int i=0;i<used/(int)sizeof(*fds);i++) if(fds[i].proc_fdtype==PROX_FDTYPE_SOCKET) {
    struct socket_fdinfo s; memset(&s,0,sizeof(s));
    if(proc_pidfdinfo(pid,(int)fds[i].proc_fd,PROC_PIDFDSOCKETINFO,&s,sizeof(s))!=sizeof(s))continue;
    if(s.psi.soi_kind==SOCKINFO_TCP && s.psi.soi_proto.pri_tcp.tcpsi_state==TSI_S_LISTEN &&
       ntohs((uint16_t)s.psi.soi_proto.pri_tcp.tcpsi_ini.insi_lport)==port) {found=true;break;}
  }
  free(fds);return found;
}
static bool signed_by_owner(pid_t pid) {
  CFNumberRef n=CFNumberCreate(NULL,kCFNumberIntType,&pid);
  const void *keys[]={kSecGuestAttributePid};const void *values[]={n};
  CFDictionaryRef attrs=CFDictionaryCreate(NULL,keys,values,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
  SecCodeRef code=NULL;SecRequirementRef req=NULL;bool ok=false;
  if(SecCodeCopyGuestWithAttributes(NULL,attrs,kSecCSDefaultFlags,&code)==errSecSuccess &&
     SecRequirementCreateWithString(CFSTR("anchor apple generic and certificate leaf[subject.OU] = \"GC4QJCRB4P\""),kSecCSDefaultFlags,&req)==errSecSuccess)
    ok=SecCodeCheckValidity(code,kSecCSStrictValidate,req)==errSecSuccess;
  if(req)CFRelease(req);if(code)CFRelease(code);CFRelease(attrs);CFRelease(n);return ok;
}
static bool daemon_profile(pid_t pid,const char *exe,const char *home) {
  int mib[]={CTL_KERN,KERN_PROCARGS2,pid};size_t size=0;
  if(sysctl(mib,3,NULL,&size,NULL,0)||size<sizeof(int)||size>1024*1024)return false;
  char *buf=calloc(1,size);if(!buf)return false;
  if(sysctl(mib,3,buf,&size,NULL,0)){free(buf);return false;}
  int argc=0;memcpy(&argc,buf,sizeof(argc));char *p=buf+sizeof(argc),*end=buf+size;
  p+=strnlen(p,(size_t)(end-p));while(p<end&&!*p)p++;
  char *args[128]={0};int got=0;
  while(p<end&&got<argc&&got<128){args[got++]=p;size_t len=strnlen(p,(size_t)(end-p));p+=len;if(p<end)p++;}
  const char *node=strstr(exe,"/Contents/Resources/node/");char expected[8192];bool match=false;
  if(node&&got>=3&&strcmp(args[2],"daemon")==0) {
    snprintf(expected,sizeof(expected),"%.*s/Contents/Resources/connector/bin/vinac.mjs",(int)(node-exe),exe);
    char actual_cli[8192],expected_cli[8192];
    // Exact paths also work for a still-running process from an ejected volume.
    // Canonicalization handles /var versus /private/var when the files exist.
    bool cli_match=strcmp(expected,args[1])==0 ||
      (realpath(args[1],actual_cli)&&realpath(expected,expected_cli)&&strcmp(actual_cli,expected_cli)==0);
    if(cli_match) for(int i=3;i+1<got;i++)
      if(strcmp(args[i],"--home")==0) {
        char a[8192],b[8192];
        if(realpath(args[i+1],a)&&realpath(home,b)&&strcmp(a,b)==0)match=true;
      }
  }
  volatile char *wipe=buf;for(size_t i=0;i<size;i++)wipe[i]=0;
  free(buf);return match;
}
static bool inspect(pid_t pid,const char *home,bool emit) {
  struct proc_bsdinfo b;char exe[PROC_PIDPATHINFO_MAXSIZE]={0};
  if(!bsd(pid,&b)){if(emit)printf("{\"exists\":false,\"pid\":%d}\n",pid);return false;}
  proc_pidpath(pid,exe,sizeof(exe));
  bool own=b.pbi_uid==getuid(),profile=own&&daemon_profile(pid,exe,home),sig=profile&&signed_by_owner(pid);
  if(emit){printf("{\"exists\":true,\"pid\":%d,\"uid\":%u,\"start\":\"%llu.%06llu\",\"exe\":",pid,b.pbi_uid,b.pbi_start_tvsec,b.pbi_start_tvusec);quoted(exe);
    printf(",\"same_uid\":%s,\"profile_match\":%s,\"signed_owner\":%s,\"eligible\":%s}\n",own?"true":"false",profile?"true":"false",sig?"true":"false",own&&profile&&sig?"true":"false");}
  return own&&profile&&sig;
}
static double monotime(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}
int main(int argc,char **argv) {
  if(argc<2)return 64;
  if(strcmp(argv[1],"lock")==0 && argc==4) {
    int fd=open(argv[2],O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK,0600);struct stat s;
    if(fd<0||fstat(fd,&s)||!S_ISREG(s.st_mode)||s.st_uid!=getuid()||s.st_nlink!=1||(s.st_mode&077))return 73;
    double deadline=monotime()+atof(argv[3])/1000.0;
    while(flock(fd,LOCK_EX|LOCK_NB)){if(errno!=EWOULDBLOCK||monotime()>=deadline)return 75;usleep(50000);}
    puts("LOCKED");fflush(stdout);char c;while(read(STDIN_FILENO,&c,1)>0){}
    flock(fd,LOCK_UN);close(fd);return 0;
  }
  if(strcmp(argv[1],"inspect")==0&&argc==4){inspect((pid_t)atoi(argv[2]),argv[3],true);return 0;}
  if(strcmp(argv[1],"owners")==0&&argc==4){
    pid_t ids[32768];int count=proc_listallpids(ids,sizeof(ids));bool comma=false;putchar('[');
    for(int i=0;i<count&&i<32768;i++)if(ids[i]>0){
      bool a=owns_port(ids[i],atoi(argv[2])),b=owns_port(ids[i],atoi(argv[3]));
      if(a||b){struct proc_bsdinfo info;if(!bsd(ids[i],&info))continue;
        if(comma)putchar(',');comma=true;
        printf("{\"pid\":%d,\"uid\":%u,\"first\":%s,\"second\":%s}",ids[i],info.pbi_uid,a?"true":"false",b?"true":"false");}
    }
    puts("]");return 0;
  }
  if(strcmp(argv[1],"signal")==0&&argc==8) {
    pid_t pid=(pid_t)atoi(argv[2]);int sig=atoi(argv[4]);struct proc_bsdinfo b;char start[80];
    if(pid<=1||pid==getpid()||(sig!=SIGTERM&&sig!=SIGKILL)||!bsd(pid,&b))return 77;
    snprintf(start,sizeof(start),"%llu.%06llu",b.pbi_start_tvsec,b.pbi_start_tvusec);
    if(strcmp(start,argv[3])||!inspect(pid,argv[5],false)||!owns_port(pid,atoi(argv[6]))||!owns_port(pid,atoi(argv[7])))return 77;
    if(kill(pid,sig))return 77;puts("{\"signalled\":true}");return 0;
  }
  return 64;
}
