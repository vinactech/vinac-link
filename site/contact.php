<?php
// vinac.tech contact form: sends each message to hello@vinac.tech with PHP's mail() on the same
// hosting (SiteGround). No outside service, no database, no cookies. Spam protection without
// trackers: a hidden trap field, a minimum time to fill in the form, a per-visitor hourly limit,
// and posts accepted only from vinac.tech. Answers JSON to the page's script, and a small page
// otherwise (when JavaScript is off).
declare(strict_types=1);

const TO = 'hello@vinac.tech';
const FROM = 'hello@vinac.tech';            // a mailbox on this domain, so the mail passes SPF
const SITE = 'https://vinac.tech';
const MAX_PER_HOUR = 5;
const MIN_SECONDS = 3;                       // people need longer than this to fill in the form
const TOPICS = ['General question', 'Partnership', 'Press', 'Security'];

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
    $title = $ok ? 'Message sent' : 'Message not sent';
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

// Only from our own pages (browsers send Origin on form posts; Referer as a fallback).
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$referer = $_SERVER['HTTP_REFERER'] ?? '';
$fromSite = static fn (string $u): bool => $u === SITE || str_starts_with($u, SITE . '/') || $u === 'https://www.vinac.tech' || str_starts_with($u, 'https://www.vinac.tech/');
if (!($origin !== '' ? $fromSite($origin) : $fromSite($referer))) reply(false, 'Please use the form on vinac.tech.', 403);

// Bots fill in the hidden field or submit instantly: pretend it worked and send nothing.
if (trim((string)($_POST['website'] ?? '')) !== '') reply(true, 'Thank you. Your message is on its way.');
$started = (int)($_POST['t'] ?? 0);
if ($started > 0 && time() - $started < MIN_SECONDS) reply(true, 'Thank you. Your message is on its way.');

$name = line((string)($_POST['name'] ?? ''), 100);
$email = line((string)($_POST['email'] ?? ''), 200);
$topic = line((string)($_POST['topic'] ?? ''), 40);
$message = trim(mb_substr(str_replace("\r\n", "\n", (string)($_POST['message'] ?? '')), 0, 5000));

if ($name === '' || $message === '') reply(false, 'Please fill in your name and a message.', 422);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) reply(false, 'Please check your email address.', 422);
if (!in_array($topic, TOPICS, true)) $topic = 'General question';

// At most MAX_PER_HOUR messages per visitor per hour (a hashed address, kept in the temp folder).
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$file = sys_get_temp_dir() . '/vinac-contact-' . hash('sha256', 'vinac-contact|' . $ip) . '.json';
$now = time();
$times = is_file($file) ? array_filter((array)json_decode((string)@file_get_contents($file), true), static fn ($t) => is_int($t) && $t > $now - 3600) : [];
if (count($times) >= MAX_PER_HOUR) reply(false, 'Too many messages from here in the last hour. Please try again later.', 429);
$times[] = $now;
@file_put_contents($file, json_encode(array_values($times)), LOCK_EX);

$subject = '=?UTF-8?B?' . base64_encode("[vinac.tech] $topic from $name") . '?=';
$body = "Topic: $topic\nName: $name\nEmail: $email\nSent: " . gmdate('Y-m-d H:i') . " UTC\n\n$message\n";
$headers = implode("\r\n", [
  'From: VINAC Link website <' . FROM . '>',
  'Reply-To: ' . $email,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit',
  'X-Mailer: vinac.tech contact form',
]);

if (!mail(TO, $subject, $body, $headers, '-f' . FROM)) reply(false, 'The message could not be sent right now.', 502);
reply(true, 'Thank you. Your message is on its way, and we will reply by email.');
