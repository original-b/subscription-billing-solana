use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("DR2RQYwi9JGFnmrzk74kHubTSi9YDCrhetASjEQXrGCZ");

#[program]
pub mod subscription_billing {
    use super::*;

    pub fn initialize_plan(
        ctx: Context<InitializePlan>,
        price: u64,
        interval: i64,
    ) -> Result<()> {
        let plan = &mut ctx.accounts.plan;
        plan.provider = ctx.accounts.provider.key();
        plan.payment_mint = ctx.accounts.payment_mint.key();
        plan.price = price;
        plan.interval = interval; // Interval in seconds
        Ok(())
    }

    pub fn subscribe(ctx: Context<Subscribe>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        let clock = Clock::get()?;
        
        subscription.subscriber = ctx.accounts.subscriber.key();
        subscription.plan = ctx.accounts.plan.key();
        subscription.start_time = clock.unix_timestamp;
        subscription.last_payment_time = 0; // Hasn't paid yet
        subscription.is_active = true;

        Ok(())
    }

    pub fn process_payment(ctx: Context<ProcessPayment>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        let plan = &ctx.accounts.plan;
        let clock = Clock::get()?;

        require!(subscription.is_active, ErrorCode::SubscriptionInactive);
        
        // Ensure enough time has passed since last payment or it's the first payment
        let next_payment_due = if subscription.last_payment_time == 0 {
            subscription.start_time
        } else {
            subscription.last_payment_time.checked_add(plan.interval).unwrap()
        };

        require!(
            clock.unix_timestamp >= next_payment_due,
            ErrorCode::PaymentNotDue
        );

        // Perform token transfer
        let cpi_accounts = Transfer {
            from: ctx.accounts.subscriber_token_account.to_account_info(),
            to: ctx.accounts.provider_token_account.to_account_info(),
            authority: ctx.accounts.subscriber.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, plan.price)?;

        // Update payment time
        subscription.last_payment_time = clock.unix_timestamp;

        Ok(())
    }

    pub fn cancel_subscription(ctx: Context<CancelSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        subscription.is_active = false;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePlan<'info> {
    #[account(
        init,
        payer = provider,
        space = 8 + 32 + 32 + 8 + 8,
        seeds = [b"plan", provider.key().as_ref(), payment_mint.key().as_ref()],
        bump
    )]
    pub plan: Account<'info, Plan>,
    #[account(mut)]
    pub provider: Signer<'info>,
    pub payment_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Subscribe<'info> {
    #[account(
        init,
        payer = subscriber,
        space = 8 + 32 + 32 + 8 + 8 + 1,
        seeds = [b"subscription", subscriber.key().as_ref(), plan.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,
    pub plan: Account<'info, Plan>,
    #[account(mut)]
    pub subscriber: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPayment<'info> {
    #[account(mut, has_one = subscriber, has_one = plan)]
    pub subscription: Account<'info, Subscription>,
    #[account(mut)]
    pub plan: Account<'info, Plan>,
    #[account(mut)]
    pub subscriber: Signer<'info>, // Required as authority for token transfer
    #[account(mut)]
    pub subscriber_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub provider_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    #[account(mut, has_one = subscriber)]
    pub subscription: Account<'info, Subscription>,
    pub subscriber: Signer<'info>,
}

#[account]
pub struct Plan {
    pub provider: Pubkey,
    pub payment_mint: Pubkey,
    pub price: u64,
    pub interval: i64,
}

#[account]
pub struct Subscription {
    pub subscriber: Pubkey,
    pub plan: Pubkey,
    pub start_time: i64,
    pub last_payment_time: i64,
    pub is_active: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The subscription is currently inactive.")]
    SubscriptionInactive,
    #[msg("Payment is not yet due for this subscription.")]
    PaymentNotDue,
}
