# Clerk Authentication Setup

This dashboard now uses Clerk for authentication.

## Environment Variables

### For Vercel (Production)
Add these in Vercel → Settings → Environment Variables:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_Z-8zyBzZYk
CLERK_SECRET_KEY=<your_clerk_secret_key_from_dashboard>
```

**Note**: Get your actual `CLERK_SECRET_KEY` from your Clerk dashboard → API Keys section.

### For Local Development
Copy `.env.local` and update with your actual Jira token:

```bash
cp .env.local .env.local.example
# Edit .env.local with your JIRA_API_TOKEN
```

## Clerk Dashboard Configuration

In your Clerk dashboard (https://dashboard.clerk.com):

1. **Application → Paths**
   - Sign-in URL: `/sign-in`
   - Sign-up URL: `/sign-up`
   - After sign-in URL: `/`
   - After sign-up URL: `/`

2. **User & Authentication → Email, Phone, Username**
   - Enable Email authentication
   - Configure as needed for your team

## How It Works

- **Public routes**: `/sign-in`, `/sign-up`
- **Protected routes**: Everything else (requires login)
- **API protection**: All `/api/*` endpoints verify Clerk tokens
- **User management**: Click the user button (top right) to manage account/sign out

## Disable Vercel Authentication

Since we're using Clerk for authentication:

1. Go to Vercel → Your Project → Settings → Deployment Protection
2. Turn OFF "Vercel Authentication"
3. This allows the site to load publicly, but Clerk protects the actual content

## Testing

1. Visit your Vercel URL
2. You should be redirected to `/sign-in`
3. Sign up with your email
4. After signing in, you'll see the dashboard
5. Click "Refresh from Jira" - it should work with proper authentication
