import test from 'node:test';
import assert from 'node:assert/strict';
import { getReservationPaymentDecision } from '../lib/reservation-payment.js';

test('automatic single appointment with deposit enabled requires a deposit payment', () => {
  const decision = getReservationPaymentDecision({
    appointmentCount: 1,
    confirmationMode: 'AUTOMATIC',
    depositEnabled: true,
    depositPercentage: 30,
    totalAmount: 100,
  });

  assert.equal(decision.requiresPaymentStep, true);
  assert.equal(decision.depositRequired, true);
  assert.equal(decision.depositAmount, 30);
  assert.equal(decision.requiresOnlinePaymentNow, true);
  assert.equal(decision.paymentIntent, 'DEPOSIT_ONLINE');
});

test('automatic single appointment with deposit disabled allows a salon-only flow', () => {
  const decision = getReservationPaymentDecision({
    appointmentCount: 1,
    confirmationMode: 'AUTOMATIC',
    depositEnabled: false,
    depositPercentage: 0,
    totalAmount: 100,
  });

  assert.equal(decision.requiresPaymentStep, true);
  assert.equal(decision.depositRequired, false);
  assert.equal(decision.depositAmount, 0);
  assert.equal(decision.requiresOnlinePaymentNow, false);
  assert.equal(decision.paymentIntent, 'NO_ONLINE_PAYMENT');
  assert.equal(decision.requiresOptionalDepositPrompt, false);
});

test('ONLINE_ONLY ignores deposit settings and requires the full amount', () => {
  const decision = getReservationPaymentDecision({
    appointmentCount: 1,
    confirmationMode: 'AUTOMATIC',
    allowedPaymentMethods: 'ONLINE_ONLY',
    depositEnabled: true,
    depositPercentage: 30,
    totalAmount: 100,
  });

  assert.equal(decision.depositRequired, false);
  assert.equal(decision.depositAmount, 0);
  assert.equal(decision.paymentIntent, 'FULL_ONLINE');
  assert.equal(decision.totalAmount, 100);
  assert.equal(decision.requiresOnlinePaymentNow, true);
});

test('manual confirmation defers payment until staff acceptance', () => {
  const decision = getReservationPaymentDecision({
    appointmentCount: 1,
    confirmationMode: 'MANUAL',
    depositEnabled: true,
    depositPercentage: 20,
    totalAmount: 80,
  });

  assert.equal(decision.requiresPaymentStep, false);
  assert.equal(decision.isManualMode, true);
  assert.equal(decision.paymentIntent, 'NONE');
});

test('multiple appointments skip the payment step entirely', () => {
  const decision = getReservationPaymentDecision({
    appointmentCount: 2,
    confirmationMode: 'AUTOMATIC',
    depositEnabled: true,
    depositPercentage: 20,
    totalAmount: 160,
  });

  assert.equal(decision.requiresPaymentStep, false);
  assert.equal(decision.paymentIntent, 'NONE');
  assert.equal(decision.requiresOptionalDepositPrompt, false);
  assert.equal(decision.requiresOptionalDepositPrompt, false);
});
