import { Redirect } from "expo-router";
/** Stripe handles authentication; returning never marks an invoice paid. */
export default function StripeReturn() { return <Redirect href="/(app)/work" />; }
