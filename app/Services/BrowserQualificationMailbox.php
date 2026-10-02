<?php

namespace App\Services;

use RuntimeException;

final class BrowserQualificationMailbox
{
    public function enabled(string $job): bool
    {
        return config('browser_qualification.enabled') === true
            && hash_equals((string) config('browser_qualification.job_id'), $job);
    }

    private function verifySocket(): string
    {
        if (!function_exists('posix_geteuid')) {
            throw new RuntimeException('Fixture coordination unavailable.');
        }
        $path = (string) config('browser_qualification.socket');
        $parent = dirname($path);
        clearstatcache(true);
        $directory = @lstat($parent);
        $socket = @lstat($path);
        $uid = posix_geteuid();
        if (!str_starts_with($path, '/') || strlen($path) > 103 || realpath($parent) !== $parent
            || !$directory || !$socket || ($directory['mode'] & 0170000) !== 0040000
            || ($socket['mode'] & 0170000) !== 0140000 || $directory['uid'] !== $uid || $socket['uid'] !== $uid
            || ($directory['mode'] & 0077) !== 0 || ($socket['mode'] & 0077) !== 0
            || (string) $directory['dev'] !== (string) config('browser_qualification.directory_dev')
            || (string) $directory['ino'] !== (string) config('browser_qualification.directory_ino')
            || (string) $socket['dev'] !== (string) config('browser_qualification.socket_dev')
            || (string) $socket['ino'] !== (string) config('browser_qualification.socket_ino')) {
            throw new RuntimeException('Fixture coordination unavailable.');
        }
        $pid = (string) config('browser_qualification.helper_pid');
        if (!preg_match('/^[1-9][0-9]{0,9}$/D', $pid)) {
            throw new RuntimeException('Fixture coordination unavailable.');
        }
        $process = @stat('/proc/'.$pid);
        if (!$process || $process['uid'] !== $uid) {
            throw new RuntimeException('Fixture coordination unavailable.');
        }
        $raw = @file_get_contents('/proc/'.$pid.'/stat');
        $tail = is_string($raw) ? substr($raw, (int) strrpos($raw, ')') + 1) : '';
        $fields = preg_split('/\s+/', trim($tail));
        if (($fields[19] ?? '') !== (string) config('browser_qualification.helper_start_ticks')) {
            throw new RuntimeException('Fixture coordination unavailable.');
        }
        return $path;
    }

    /** @return array<string,mixed> */
    public function exchange(array $message): array
    {
        $path = $this->verifySocket();
        $bytes = json_encode($message, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        if (strlen($bytes) > 65536) {
            throw new RuntimeException('Fixture response exceeds its bound.');
        }
        $stream = @stream_socket_client('unix://'.$path, $errno, $error, 1, STREAM_CLIENT_CONNECT);
        if (!$stream) {
            throw new RuntimeException('Fixture coordination unavailable.');
        }
        try {
            stream_set_timeout($stream, 1);
            $this->verifySocket();
            $remaining = $bytes."\n";
            while ($remaining !== '') {
                $written = fwrite($stream, $remaining);
                if ($written === false || $written === 0) {
                    throw new RuntimeException('Fixture response is unconfirmed.');
                }
                $remaining = substr($remaining, $written);
            }
            $reply = fgets($stream, 65538);
            if (!is_string($reply) || strlen($reply) > 65536 || !str_ends_with($reply, "\n")) {
                throw new RuntimeException('Fixture response is unconfirmed.');
            }
            $this->verifySocket();
            $value = json_decode($reply, true, flags: JSON_THROW_ON_ERROR);
            if (!is_array($value) || ($value['status'] ?? '') !== 'ok' || !is_array($value['result'] ?? null)) {
                throw new RuntimeException('Fixture request refused or unavailable.');
            }
            return $value['result'];
        } finally {
            fclose($stream);
        }
    }

    /** @return array<string,mixed> */
    public function binding(string $job): array
    {
        if (!$this->enabled($job)) {
            abort(404);
        }
        $binding = $this->exchange(['protocol' => 1, 'action' => 'binding']);
        if (($binding['job_id'] ?? '') !== $job || !is_int($binding['created_at'] ?? null)
            || !is_int($binding['expires_at'] ?? null) || $binding['created_at'] > time()
            || $binding['expires_at'] <= time() || $binding['expires_at'] - $binding['created_at'] > 600) {
            throw new RuntimeException('Fixture coordination expired or changed.');
        }
        return $binding;
    }
}
