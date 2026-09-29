<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_subscription_states', function (Blueprint $table) {
            $table->string('subscription_id')->primary();
            $table->string('customer_id');
            $table->string('price_id');
            $table->unsignedBigInteger('event_created');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_subscription_states');
    }
};
