FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev libusb-dev
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY dashboard/ ./

# Repo source files read by server components via lib/code-samples.ts
# (fs.readFileSync at build- and request-time). Paths mirror the repo layout
# so APERTURE_REPO_ROOT can resolve them.
COPY sdk /repo/sdk
COPY scripts /repo/scripts
COPY services /repo/services
COPY circuits /repo/circuits
COPY programs /repo/programs
ENV APERTURE_REPO_ROOT=/repo

# Next.js collects anonymous telemetry — disable it
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_ vars must be available at build time for Next.js to inline them
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_POLICY_SERVICE_URL=http://localhost:3001
ARG NEXT_PUBLIC_COMPLIANCE_API_URL=http://localhost:3002
ARG NEXT_PUBLIC_PROVER_SERVICE_URL=http://localhost:3003
ARG NEXT_PUBLIC_AGENT_SERVICE_URL=http://localhost:3004
ARG NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_SOLANA_NETWORK=devnet
ARG NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM=FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU
ARG NEXT_PUBLIC_VERIFIER_PROGRAM=AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU
ARG NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM=3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt
ARG NEXT_PUBLIC_LIGHT_RPC_URL
ARG NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT=EraJfY2Lk1BpWHjBZuxA1T8Re36D515JLkW1FFo7Ah1P
ARG NEXT_PUBLIC_VUSDC_MINT=E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar

ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_POLICY_SERVICE_URL=$NEXT_PUBLIC_POLICY_SERVICE_URL
ENV NEXT_PUBLIC_COMPLIANCE_API_URL=$NEXT_PUBLIC_COMPLIANCE_API_URL
ENV NEXT_PUBLIC_PROVER_SERVICE_URL=$NEXT_PUBLIC_PROVER_SERVICE_URL
ENV NEXT_PUBLIC_AGENT_SERVICE_URL=$NEXT_PUBLIC_AGENT_SERVICE_URL
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL
ENV NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK
ENV NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM=$NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM
ENV NEXT_PUBLIC_VERIFIER_PROGRAM=$NEXT_PUBLIC_VERIFIER_PROGRAM
ENV NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM=$NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM
ENV NEXT_PUBLIC_LIGHT_RPC_URL=$NEXT_PUBLIC_LIGHT_RPC_URL
ENV NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT=$NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT
ENV NEXT_PUBLIC_VUSDC_MINT=$NEXT_PUBLIC_VUSDC_MINT

RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV APERTURE_REPO_ROOT=/repo

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Keep the repo code samples available at request-time — server components
# read them via fs.readFileSync when rendering /developers and /integrate.
COPY --from=builder --chown=nextjs:nodejs /repo /repo

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
