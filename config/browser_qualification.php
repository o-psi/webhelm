<?php

return [
    'enabled' => (bool) env('HELM_BROWSER_QUALIFICATION_ENABLED', false),
    'job_id' => env('HELM_BROWSER_QUALIFICATION_JOB', ''),
    'socket' => env('HELM_BROWSER_QUALIFICATION_SOCKET', ''),
    'socket_dev' => env('HELM_BROWSER_QUALIFICATION_SOCKET_DEV', ''),
    'socket_ino' => env('HELM_BROWSER_QUALIFICATION_SOCKET_INO', ''),
    'directory_dev' => env('HELM_BROWSER_QUALIFICATION_DIRECTORY_DEV', ''),
    'directory_ino' => env('HELM_BROWSER_QUALIFICATION_DIRECTORY_INO', ''),
    'helper_pid' => env('HELM_BROWSER_QUALIFICATION_PID', ''),
    'helper_start_ticks' => env('HELM_BROWSER_QUALIFICATION_START_TICKS', ''),
];
