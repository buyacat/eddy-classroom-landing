<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');

const TO_EMAIL    = 'office@llcise.com';
const FROM_EMAIL  = 'no-reply@eddy.org.ua';
const FROM_NAME   = 'Eddy Classroom';
const SUBJECT     = 'Нова заявка — Eddy Classroom';
const MAX_BODY    = 20000;
const THROTTLE_S  = 10;

$apiKey = getenv('MANDRILL_KEY')
    ?: trim((string) @file_get_contents(__DIR__ . '/../mandrill.key'));

function fail(int $code, string $error): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $error], JSON_UNESCAPED_UNICODE);
    exit;
}

function ok(): never {
    echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
    exit;
}

function clean(string $value, int $max): string {
    $value = str_replace(["\r", "\n", "\0"], ' ', $value);
    return mb_substr(trim(strip_tags($value)), 0, $max);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail(405, 'method_not_allowed');
}

if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY) {
    fail(413, 'payload_too_large');
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$throttleFile = sys_get_temp_dir() . '/eddy_classroom_rl_' . md5($ip);
$now = time();
if (is_file($throttleFile) && ($now - (int) @file_get_contents($throttleFile)) < THROTTLE_S) {
    fail(429, 'too_many_requests');
}
@file_put_contents($throttleFile, (string) $now);

if (trim((string) ($_POST['website'] ?? '')) !== '') {
    ok();
}

$name     = clean((string) ($_POST['name'] ?? ''), 120);
$org      = clean((string) ($_POST['org'] ?? ''), 200);
$role     = clean((string) ($_POST['role'] ?? ''), 40);
$students = clean((string) ($_POST['students'] ?? ''), 80);
$phone    = clean((string) ($_POST['phone'] ?? ''), 40);
$email    = clean((string) ($_POST['email'] ?? ''), 200);
$comment  = mb_substr(trim(strip_tags((string) ($_POST['comment'] ?? ''))), 0, 2000);

if ($name === '') {
    fail(422, 'name_required');
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fail(422, 'invalid_email');
}
if ($apiKey === '') {
    fail(500, 'mail_not_configured');
}

$body = implode("\n", [
    "Ім'я: {$name}",
    "Організація: {$org}",
    "Посада: {$role}",
    "Учнів/класів: {$students}",
    "Телефон: {$phone}",
    "Email: {$email}",
    "Коментар: {$comment}",
]);

$payload = [
    'key'     => $apiKey,
    'message' => [
        'from_email' => FROM_EMAIL,
        'from_name'  => FROM_NAME,
        'subject'    => SUBJECT,
        'text'       => $body,
        'to'         => [['email' => TO_EMAIL, 'type' => 'to']],
        'headers'    => ['Reply-To' => $email],
    ],
];

$ch = curl_init('https://mandrillapp.com/api/1.0/messages/send.json');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) {
    fail(502, 'mail_transport_error');
}

$data = json_decode((string) $response, true);

if ($httpCode !== 200 || (isset($data['status']) && $data['status'] === 'error')) {
    fail(502, 'mail_rejected');
}

if (in_array($data[0]['status'] ?? '', ['sent', 'queued', 'scheduled'], true)) {
    ok();
}

fail(502, 'mail_rejected');
