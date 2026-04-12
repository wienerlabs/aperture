import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';

const POLICY_SERVICE_URL = process.env.POLICY_SERVICE_URL ?? process.env.NEXT_PUBLIC_POLICY_SERVICE_URL ?? 'http://localhost:3001';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required');
        }

        const res = await fetch(`${POLICY_SERVICE_URL}/api/v1/auth/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email.trim().toLowerCase(),
            password: credentials.password,
          }),
        });

        const body = await res.json();

        if (!res.ok || !body.success) {
          throw new Error(body.error ?? 'Invalid email or password');
        }

        return {
          id: body.data.id,
          email: body.data.email,
          name: body.data.name,
        };
      },
    }),
    CredentialsProvider({
      id: 'wallet',
      name: 'Wallet',
      credentials: {
        wallet_address: { label: 'Wallet Address', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
        message: { label: 'Message', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.wallet_address || !credentials?.signature || !credentials?.message) {
          throw new Error('Wallet address, signature, and message are required');
        }

        const res = await fetch(`${POLICY_SERVICE_URL}/api/v1/auth/wallet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: credentials.wallet_address,
            signature: credentials.signature,
            message: credentials.message,
          }),
        });

        const body = await res.json();

        if (!res.ok || !body.success) {
          throw new Error(body.error ?? 'Wallet authentication failed');
        }

        return {
          id: body.data.id,
          email: body.data.email,
          name: body.data.wallet_address ?? body.data.name,
          image: body.data.wallet_address ?? undefined,
        };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],

  session: {
    strategy: 'jwt',
  },

  pages: {
    signIn: '/auth/signin',
  },

  secret: process.env.NEXTAUTH_SECRET,

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.walletAddress = user.image ?? undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; walletAddress?: string }).id = token.id as string;
        (session.user as { walletAddress?: string }).walletAddress = token.walletAddress as string | undefined;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
};
