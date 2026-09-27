# runly-backup — restic-based backup sidecar for Postgres, Supabase Storage,
# and instance config. See docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md.
#
# Based on the official postgres:17-alpine image (not plain alpine) so
# pg_dump/pg_restore match supabase/postgres:17.6.1.136's major version
# exactly, without guessing an Alpine postgresql-client package name.
FROM postgres:17-alpine

RUN apk add --no-cache bash coreutils tzdata curl jq restic rclone

# supercronic (cron built for containers: forwards job stdout/stderr to its
# own stdout, which is what `docker compose logs` shows) has no apk package —
# install the static binary directly. TARGETARCH is set automatically by
# docker buildx for each platform in PLATFORMS (see build-push.mjs).
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.34
RUN case "${TARGETARCH}" in \
      amd64) SUPERCRONIC_ARCH=amd64 ;; \
      arm64) SUPERCRONIC_ARCH=arm64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSLo /usr/local/bin/supercronic \
       "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${SUPERCRONIC_ARCH}" \
    && chmod +x /usr/local/bin/supercronic

WORKDIR /app
COPY apps/backup/entrypoint.sh apps/backup/run-backup.sh apps/backup/verify-backup.sh ./
RUN chmod +x /app/*.sh

# Clear the inherited `CMD ["postgres"]` from postgres:17-alpine — this image
# never runs a Postgres server, only pg_dump/pg_restore, so passing "postgres"
# as an unused argument to entrypoint.sh would be confusing in `docker inspect`
# even though entrypoint.sh itself ignores "$@".
CMD []
ENTRYPOINT ["/app/entrypoint.sh"]
