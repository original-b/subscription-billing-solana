import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("subscription_billing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const subscriptionBillingIdl: anchor.Idl = {
    address: "DR2RQYwi9JGFnmrzk74kHubTSi9YDCrhetASjEQXrGCZ",
    metadata: {
      name: "subscription_billing",
      version: "0.1.0",
      spec: "0.1.0",
    },
    instructions: [
      {
        name: "initialize_plan",
        discriminator: [207, 161, 230, 194, 86, 77, 169, 8],
        accounts: [
          { name: "plan", writable: true },
          { name: "provider", writable: true, signer: true },
          { name: "payment_mint" },
          { name: "system_program" },
        ],
        args: [
          { name: "price", type: "u64" },
          { name: "interval", type: "i64" },
        ],
      },
      {
        name: "subscribe",
        discriminator: [254, 28, 191, 138, 156, 179, 183, 53],
        accounts: [
          { name: "subscription", writable: true },
          { name: "plan" },
          { name: "subscriber", writable: true, signer: true },
          { name: "system_program" },
        ],
        args: [],
      },
      {
        name: "process_payment",
        discriminator: [189, 81, 30, 198, 139, 186, 115, 23],
        accounts: [
          { name: "subscription", writable: true },
          { name: "plan", writable: true },
          { name: "subscriber", writable: true, signer: true },
          { name: "subscriber_token_account", writable: true },
          { name: "provider_token_account", writable: true },
          { name: "token_program" },
        ],
        args: [],
      },
      {
        name: "cancel_subscription",
        discriminator: [60, 139, 189, 242, 191, 208, 143, 18],
        accounts: [
          { name: "subscription", writable: true },
          { name: "subscriber", signer: true },
        ],
        args: [],
      },
    ],
    accounts: [
      {
        name: "plan",
        discriminator: [161, 231, 251, 119, 2, 12, 162, 2],
      },
      {
        name: "subscription",
        discriminator: [64, 7, 26, 135, 102, 132, 98, 33],
      },
    ],
    types: [
      {
        name: "plan",
        type: {
          kind: "struct",
          fields: [
            { name: "provider", type: "pubkey" },
            { name: "payment_mint", type: "pubkey" },
            { name: "price", type: "u64" },
            { name: "interval", type: "i64" },
          ],
        },
      },
      {
        name: "subscription",
        type: {
          kind: "struct",
          fields: [
            { name: "subscriber", type: "pubkey" },
            { name: "plan", type: "pubkey" },
            { name: "start_time", type: "i64" },
            { name: "last_payment_time", type: "i64" },
            { name: "is_active", type: "bool" },
          ],
        },
      },
    ],
    errors: [
      {
        code: 6000,
        name: "subscription_inactive",
        msg: "The subscription is currently inactive.",
      },
      {
        code: 6001,
        name: "payment_not_due",
        msg: "Payment is not yet due for this subscription.",
      },
      {
        code: 6002,
        name: "invalid_provider_token_account_owner",
        msg: "Provider token account owner must match the plan provider.",
      },
      {
        code: 6003,
        name: "invalid_provider_token_account_mint",
        msg: "Provider token account mint must match the plan payment mint.",
      },
    ],
  };

  const program = new Program(subscriptionBillingIdl, provider);

  const providerKeypair = anchor.web3.Keypair.generate();
  const subscriberKeypair = anchor.web3.Keypair.generate();
  const pocSubscriberKeypair = anchor.web3.Keypair.generate();
  
  let mint: anchor.web3.PublicKey;
  let providerTokenAccount: anchor.web3.PublicKey;
  let subscriberTokenAccount: anchor.web3.PublicKey;
  let pocSubscriberSourceTokenAccount: anchor.web3.PublicKey;
  let pocSubscriberSelfTokenAccount: anchor.web3.PublicKey;

  let planPda: anchor.web3.PublicKey;
  let subscriptionPda: anchor.web3.PublicKey;
  let pocSubscriptionPda: anchor.web3.PublicKey;

  const price = new BN(1000);
  const interval = new BN(60); // 60 seconds

  before(async () => {
    // Airdrop SOL
    const airdrop1 = await provider.connection.requestAirdrop(providerKeypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const airdrop2 = await provider.connection.requestAirdrop(subscriberKeypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const airdrop3 = await provider.connection.requestAirdrop(pocSubscriberKeypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdrop1,
      ...latestBlockhash,
    });
    await provider.connection.confirmTransaction({
      signature: airdrop2,
      ...latestBlockhash,
    });
    await provider.connection.confirmTransaction({
      signature: airdrop3,
      ...latestBlockhash,
    });

    // Create mint
    mint = await createMint(
      provider.connection,
      providerKeypair,
      providerKeypair.publicKey,
      null,
      6
    );

    // Create token accounts
    providerTokenAccount = await createAccount(
      provider.connection,
      providerKeypair,
      mint,
      providerKeypair.publicKey,
      anchor.web3.Keypair.generate()
    );

    subscriberTokenAccount = await createAccount(
      provider.connection,
      subscriberKeypair,
      mint,
      subscriberKeypair.publicKey,
      anchor.web3.Keypair.generate()
    );

    // Mint tokens to subscriber
    await mintTo(
      provider.connection,
      providerKeypair,
      mint,
      subscriberTokenAccount,
      providerKeypair.publicKey,
      10000
    );

    // Create two token accounts for the PoC subscriber:
    // one source account and one fake "provider" destination account.
    pocSubscriberSourceTokenAccount = await createAccount(
      provider.connection,
      pocSubscriberKeypair,
      mint,
      pocSubscriberKeypair.publicKey,
      anchor.web3.Keypair.generate()
    );

    pocSubscriberSelfTokenAccount = await createAccount(
      provider.connection,
      pocSubscriberKeypair,
      mint,
      pocSubscriberKeypair.publicKey,
      anchor.web3.Keypair.generate()
    );

    // Fund PoC source account.
    await mintTo(
      provider.connection,
      providerKeypair,
      mint,
      pocSubscriberSourceTokenAccount,
      providerKeypair.publicKey,
      10000
    );

    // Find PDAs
    [planPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("plan"), providerKeypair.publicKey.toBuffer(), mint.toBuffer()],
      program.programId
    );

    [subscriptionPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("subscription"), subscriberKeypair.publicKey.toBuffer(), planPda.toBuffer()],
      program.programId
    );

    [pocSubscriptionPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("subscription"), pocSubscriberKeypair.publicKey.toBuffer(), planPda.toBuffer()],
      program.programId
    );
  });

  it("Initializes a plan", async () => {
    await program.methods
      .initializePlan(price, interval)
      .accounts({
        plan: planPda,
        provider: providerKeypair.publicKey,
        paymentMint: mint,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([providerKeypair])
      .rpc();

    const planAccount = await program.account.plan.fetch(planPda);
    assert.ok(planAccount.provider.equals(providerKeypair.publicKey));
    assert.ok(planAccount.paymentMint.equals(mint));
    assert.ok(planAccount.price.eq(price));
    assert.ok(planAccount.interval.eq(interval));
  });

  it("Subscribes to a plan", async () => {
    await program.methods
      .subscribe()
      .accounts({
        subscription: subscriptionPda,
        plan: planPda,
        subscriber: subscriberKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([subscriberKeypair])
      .rpc();

    const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
    assert.ok(subscriptionAccount.subscriber.equals(subscriberKeypair.publicKey));
    assert.ok(subscriptionAccount.plan.equals(planPda));
    assert.ok(subscriptionAccount.isActive);
    assert.ok(subscriptionAccount.lastPaymentTime.eq(new BN(0)));
  });

  it("PoC: rejects payment when provider token account is not owned by provider", async () => {
    await program.methods
      .subscribe()
      .accounts({
        subscription: pocSubscriptionPda,
        plan: planPda,
        subscriber: pocSubscriberKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([pocSubscriberKeypair])
      .rpc();

    const realProviderBalanceBefore = (await getAccount(provider.connection, providerTokenAccount)).amount;
    const fakeProviderBalanceBefore = (await getAccount(provider.connection, pocSubscriberSelfTokenAccount)).amount;
    const pocSubscriberSourceBalanceBefore = (await getAccount(provider.connection, pocSubscriberSourceTokenAccount)).amount;

    let maliciousPaymentError: unknown;
    try {
      await program.methods
        .processPayment()
        .accounts({
          subscription: pocSubscriptionPda,
          plan: planPda,
          subscriber: pocSubscriberKeypair.publicKey,
          subscriberTokenAccount: pocSubscriberSourceTokenAccount,
          // Intentionally wrong: this token account belongs to the subscriber,
          // not to the plan's provider.
          providerTokenAccount: pocSubscriberSelfTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([pocSubscriberKeypair])
        .rpc();
      assert.fail("Malicious payment should fail account constraints");
    } catch (error) {
      maliciousPaymentError = error;
    }

    const realProviderBalanceAfter = (await getAccount(provider.connection, providerTokenAccount)).amount;
    const fakeProviderAccountAfter = await getAccount(provider.connection, pocSubscriberSelfTokenAccount);
    const fakeProviderBalanceAfter = fakeProviderAccountAfter.amount;
    const pocSubscriberSourceBalanceAfter = (await getAccount(provider.connection, pocSubscriberSourceTokenAccount)).amount;
    const pocSubscriptionAccount = await program.account.subscription.fetch(pocSubscriptionPda);

    const errorMessage = `${maliciousPaymentError}`;
    assert.match(
      errorMessage,
      /InvalidProviderTokenAccountOwner|ConstraintRaw|custom program error/i
    );
    assert.ok(fakeProviderAccountAfter.owner.equals(pocSubscriberKeypair.publicKey));
    assert.equal(realProviderBalanceAfter - realProviderBalanceBefore, BigInt(0));
    assert.equal(fakeProviderBalanceAfter - fakeProviderBalanceBefore, BigInt(0));
    assert.equal(pocSubscriberSourceBalanceBefore - pocSubscriberSourceBalanceAfter, BigInt(0));
    assert.ok(pocSubscriptionAccount.lastPaymentTime.eq(new BN(0)));
  });

  it("Processes a payment", async () => {
    const subscriberBalanceBefore = (await getAccount(provider.connection, subscriberTokenAccount)).amount;
    const providerBalanceBefore = (await getAccount(provider.connection, providerTokenAccount)).amount;

    await program.methods
      .processPayment()
      .accounts({
        subscription: subscriptionPda,
        plan: planPda,
        subscriber: subscriberKeypair.publicKey,
        subscriberTokenAccount: subscriberTokenAccount,
        providerTokenAccount: providerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([subscriberKeypair])
      .rpc();

    const subscriberBalanceAfter = (await getAccount(provider.connection, subscriberTokenAccount)).amount;
    const providerBalanceAfter = (await getAccount(provider.connection, providerTokenAccount)).amount;

    assert.equal(subscriberBalanceBefore - subscriberBalanceAfter, BigInt(1000));
    assert.equal(providerBalanceAfter - providerBalanceBefore, BigInt(1000));

    const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
    assert.ok(subscriptionAccount.lastPaymentTime.gt(new BN(0)));
  });

  it("Cancels a subscription", async () => {
    await program.methods
      .cancelSubscription()
      .accounts({
        subscription: subscriptionPda,
        subscriber: subscriberKeypair.publicKey,
      })
      .signers([subscriberKeypair])
      .rpc();

    const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
    assert.isFalse(subscriptionAccount.isActive);
  });
});
