# Subscription Billing on Solana

This project is a submission for the "Rebuild production backend systems as on-chain Rust programs" Challenge. It implements a core subscription billing engine on Solana, replacing traditional web2 subscription logic (like Stripe Billing) with an on-chain state machine.

## Architecture Explanation

### How this works in Web2
In a traditional Web2 architecture, a subscription billing system typically involves:
1. A centralized database (PostgreSQL, MySQL) storing users, plans, and active subscriptions.
2. A recurring cron job or background worker that checks for subscriptions due for renewal.
3. Integration with a payment gateway (e.g., Stripe, PayPal) to charge the user's credit card.
4. Webhooks to update the subscription status upon successful or failed payments.
The system relies heavily on centralized trust, and the service provider controls the user's billing cycle and data.

### How this works on Solana
On Solana, the subscription billing system is reframed as a distributed state machine:
1. **Plans and Subscriptions as Accounts**: Subscription plans and active user subscriptions are stored as PDAs (Program Derived Addresses) on-chain.
2. **Push vs. Pull Payments**: Instead of the provider pulling funds automatically, the user or a crank (keeper) triggers the renewal transaction. The smart contract validates the time elapsed since the last payment and transfers SPL tokens or SOL from the user's token account to the provider.
3. **Decentralized Execution**: The logic for creating plans, subscribing, and renewing is enforced by the on-chain Rust program. No centralized database is needed.
4. **Token Integration**: Payments are handled natively using SPL tokens, ensuring atomic settlement without third-party payment gateways.

### Tradeoffs & Constraints
- **Automation Constraints**: Solana programs cannot automatically execute at a specific time. Renewals must be triggered externally by a "crank" or the user themselves.
- **State Rent**: Storing plans and subscriptions on-chain requires SOL for rent exemption, which adds an upfront cost compared to a traditional database.
- **Account Concurrency**: High-frequency renewals for the same plan might face account contention, requiring careful state design (e.g., avoiding a single global state account for all payments).

## Devnet Deployment
*Note: Due to Solana Devnet airdrop rate limits during the development phase, the final deployment transaction could not be completed (insufficient SOL for program deployment rent). The program is fully tested and ready for deployment.*

## Client Interface
The project includes a comprehensive test suite (`tests/subscription_billing.ts`) that acts as a minimal client. It demonstrates:
- Creating a subscription plan.
- Subscribing a user to the plan.
- Renewing the subscription after the required time interval.
- Canceling the subscription.

To run the client tests:
```bash
npm install
anchor test
```
