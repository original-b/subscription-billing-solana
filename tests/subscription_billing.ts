import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SubscriptionBilling } from "../target/types/subscription_billing";
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

  const program = anchor.workspace.SubscriptionBilling as Program<SubscriptionBilling>;

  const providerKeypair = anchor.web3.Keypair.generate();
  const subscriberKeypair = anchor.web3.Keypair.generate();
  
  let mint: anchor.web3.PublicKey;
  let providerTokenAccount: anchor.web3.PublicKey;
  let subscriberTokenAccount: anchor.web3.PublicKey;

  let planPda: anchor.web3.PublicKey;
  let subscriptionPda: anchor.web3.PublicKey;

  const price = new anchor.BN(1000);
  const interval = new anchor.BN(60); // 60 seconds

  before(async () => {
    // Airdrop SOL
    const airdrop1 = await provider.connection.requestAirdrop(providerKeypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const airdrop2 = await provider.connection.requestAirdrop(subscriberKeypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdrop1,
      ...latestBlockhash,
    });
    await provider.connection.confirmTransaction({
      signature: airdrop2,
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
      providerKeypair.publicKey
    );

    subscriberTokenAccount = await createAccount(
      provider.connection,
      subscriberKeypair,
      mint,
      subscriberKeypair.publicKey
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

    // Find PDAs
    [planPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("plan"), providerKeypair.publicKey.toBuffer(), mint.toBuffer()],
      program.programId
    );

    [subscriptionPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("subscription"), subscriberKeypair.publicKey.toBuffer(), planPda.toBuffer()],
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
    assert.ok(subscriptionAccount.lastPaymentTime.eq(new anchor.BN(0)));
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
    assert.ok(subscriptionAccount.lastPaymentTime.gt(new anchor.BN(0)));
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
