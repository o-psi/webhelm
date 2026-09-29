<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('billing_checkout_intents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('plan', 16);
            $table->string('interval', 8);
            $table->string('payment_link_id');
            $table->string('checkout_session_id')->nullable()->unique();
            $table->string('status', 16)->default('pending');
            $table->timestamps();
            $table->index(['tenant_id', 'created_at']);
        });
        Schema::create('billing_invoice_periods', function (Blueprint $table) {
            $table->string('invoice_id')->primary();
            $table->string('subscription_id')->index();
            $table->string('customer_id');
            $table->string('price_id');
            $table->unsignedBigInteger('starts_at');
            $table->unsignedBigInteger('ends_at');
            $table->unsignedBigInteger('paid_at');
            $table->timestamps();
        });
        Schema::create('billing_subscription_endings', function (Blueprint $table) {
            $table->string('subscription_id')->primary();
            $table->unsignedBigInteger('ended_at');
            $table->timestamps();
        });
        Schema::create('billing_webhook_events', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('type');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('billing_webhook_events');
        Schema::dropIfExists('billing_subscription_endings');
        Schema::dropIfExists('billing_invoice_periods');
        Schema::dropIfExists('billing_checkout_intents');
    }
};
