<?php
// vinac.tech newsletter signup: emails each signup (with the consent the person gave) to
// hello@vinac.tech with PHP's mail(), and also appends it to a CSV kept OUTSIDE the public web
// folder (one level above public_html), so the list can be exported to a newsletter tool later.
// No outside service, no cookies. Same spam guards as contact.php: a hidden trap field, a minimum
// time on the page, a per-visitor hourly limit, and posts accepted only from vinac.tech.
// Canada's CASL: consent is an unticked box the person ticks; we record what they agreed to and
// when. Nothing is ever sent to the address from here (so the form can't be used to spam people).
declare(strict_types=1);

const TO = 'hello@vinac.tech';
const FROM = 'hello@vinac.tech';            // a mailbox on this domain, so the mail passes SPF
const SITE = 'https://vinac.tech';
const MAX_PER_HOUR = 5;
const MIN_SECONDS = 2;
const CONSENT = 'Yes, email me VINAC Link news and releases (a few times a year). I can unsubscribe at any time.';

$wantsJson = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

function reply(bool $ok, string $message, int $status = 200): void {
  global $wantsJson;
  http_response_code($status);
  header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff');
  if ($wantsJson) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($ok ? ['ok' => true] : ['ok' => false, 'error' => $message]);
  } else {
    header('Content-Type: text/html; charset=utf-8');
    $title = $ok ? 'Subscribed' : 'Not subscribed';
    $text = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
    echo "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
      . "<title>$title · VINAC Link</title><link rel=\"stylesheet\" href=\"/styles.css\"></head>"
      . "<body><main class=\"wrap notfound\"><h1>$title</h1><p>$text</p><p><a href=\"/\">Back to vinac.tech</a></p></main></body></html>";
  }
  exit;
}

// A single line of text: no line breaks (they would let someone add their own mail headers).
function line(string $value, int $max): string {
  $value = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? '';
  return trim(mb_substr($value, 0, $max));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') reply(false, 'Please use the form on vinac.tech.', 405);

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$referer = $_SERVER['HTTP_REFERER'] ?? '';
$fromSite = static fn (string $u): bool => $u === SITE || str_starts_with($u, SITE . '/') || $u === 'https://www.vinac.tech' || str_starts_with($u, 'https://www.vinac.tech/');
if (!($origin !== '' ? $fromSite($origin) : $fromSite($referer))) reply(false, 'Please use the form on vinac.tech.', 403);

$done = 'Thank you. You are on the list; we write a few times a year.';
if (trim((string)($_POST['website'] ?? '')) !== '') reply(true, $done);
$started = (int)($_POST['t'] ?? 0);
if ($started > 0 && time() - $started < MIN_SECONDS) reply(true, $done);

$email = line((string)($_POST['email'] ?? ''), 200);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) reply(false, 'Please check your email address.', 422);
if (($_POST['consent'] ?? '') !== 'yes') reply(false, 'Please tick the box to agree to receive our emails.', 422);

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$file = sys_get_temp_dir() . '/vinac-subscribe-' . hash('sha256', 'vinac-subscribe|' . $ip) . '.json';
$now = time();
$times = is_file($file) ? array_filter((array)json_decode((string)@file_get_contents($file), true), static fn ($t) => is_int($t) && $t > $now - 3600) : [];
if (count($times) >= MAX_PER_HOUR) reply(false, 'Too many signups from here in the last hour. Please try again later.', 429);
$times[] = $now;
@file_put_contents($file, json_encode(array_values($times)), LOCK_EX);

$when = gmdate('Y-m-d H:i:s') . ' UTC';
// The list itself, outside the web folder (never downloadable). Best effort: the email is the record.
$csv = dirname(__DIR__) . '/vinac-newsletter-subscribers.csv';
$row = '"' . str_replace('"', '""', $email) . "\",\"$when\",\"vinac.tech form\",\"" . str_replace('"', '""', CONSENT) . "\"\n";
if (!is_file($csv)) @file_put_contents($csv, "email,subscribed_at,source,consent\n", LOCK_EX);
@file_put_contents($csv, $row, FILE_APPEND | LOCK_EX);

$subject = '=?UTF-8?B?' . base64_encode("[vinac.tech] Newsletter signup: $email") . '?=';
$body = "New newsletter signup\n\nEmail: $email\nSubscribed: $when\nSource: vinac.tech form\nConsent given: \"" . CONSENT . "\"\n\n"
  . "Keep this email as the consent record (CASL). To unsubscribe someone, remove them from the list\n"
  . "(vinac-newsletter-subscribers.csv, one level above public_html) and from any newsletter tool.\n";
$headers = implode("\r\n", [
  'From: VINAC Link website <' . FROM . '>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit',
  'X-Mailer: vinac.tech newsletter form',
]);
if (!mail(TO, $subject, $body, $headers, '-f' . FROM)) reply(false, 'The signup could not be saved right now.', 502);
reply(true, $done);
