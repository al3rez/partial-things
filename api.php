<?php

declare(strict_types=1);

require __DIR__ . '/lib/Store.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $store = Store::open(__DIR__ . '/data/things.sqlite');
    $body = [];
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
        $raw = file_get_contents('php://input') ?: '';
        if ($raw !== '') {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                throw new InvalidArgumentException('Invalid JSON');
            }
            $body = $decoded;
        }
    }
    $action = (string) ($body['action'] ?? ($_GET['action'] ?? 'state'));
    echo json_encode($store->handle($action, $body), JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
