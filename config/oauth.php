<?php

return [
    // Extending this registry requires an audited Socialite OAuth2 driver.
    'providers' => [
        'google' => ['label' => 'Google', 'scopes' => ['openid', 'profile', 'email']],
        'x' => ['label' => 'X', 'scopes' => ['users.read', 'tweet.read']],
        'microsoft' => ['label' => 'Microsoft', 'scopes' => ['openid', 'profile', 'User.Read']],
        'github' => ['label' => 'GitHub', 'scopes' => ['read:user', 'user:email']],
    ],
];
