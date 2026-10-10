import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentJourneyBar } from '../../client/src/components/PaymentJourney';
const render = (props: any) => renderToStaticMarkup(React.createElement(PaymentJourneyBar, props));
test('partial refund shows adjusted earnings and fee history, not a reset payout journey', () => {
  const html = render({paymentStatus:'partially_refunded',refundedPence:400,platformFeePence:110,feeRefundedPence:44,freelancerPence:534});
  for (const value of ['Partially refunded','£4.00','£5.34','£1.10','£0.44','£0.66']) assert.ok(html.includes(value),value);
  assert.ok(!html.includes('Client Paid'));
  assert.ok(!html.includes('>Now<'));
});
test('cancelled attempt cannot claim payment confirmation or earnings', () => {
  const html=render({paymentStatus:'cancelled',freelancerPence:89});
  assert.ok(html.includes('Cancelled'));
  assert.ok(html.includes('No confirmed earnings'));
  assert.ok(!html.includes('£0.89'));
  assert.ok(!html.includes('Client Paid'));
});
test('refund journey without amount does not invent a zero refund', () => {
  assert.ok(!render({paymentStatus:'refunded'}).includes('£0.00'));
});
