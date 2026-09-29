<?php

namespace App;

enum WebPlan: string
{
    case Free = 'free';
    case Basic = 'basic';
    case Pro = 'pro';

    public function vesselLimit(): int
    {
        return match ($this) {
            self::Free => 8,
            self::Basic => 16,
            self::Pro => 64,
        };
    }
}
