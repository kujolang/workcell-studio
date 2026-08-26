FROM debian:trixie-slim@sha256:abc9cb88a5587630d7f915f47b23b0668fe250fbfc6457aa4d52b534c1bbf73f
ARG KUJO_VERSION=1.0.0
ARG KUJO_COMMIT=2b3e07d398016e92008d8399e79c441e012dce38
LABEL org.opencontainers.image.source="https://github.com/kujolang/kujo" \
      org.opencontainers.image.revision="$KUJO_COMMIT" \
      org.opencontainers.image.version="$KUJO_VERSION"
ADD --checksum=sha256:77398f60d0f9d29b7ae1351ea234ba7a56ccc1ce6802e2891d7ff0572ac2e52f \
    https://github.com/kujolang/kujo/releases/download/v1.0.0/kujo-v1.0.0-linux-x64.tar.gz \
    /tmp/kujo.tar.gz
RUN tar -xzf /tmp/kujo.tar.gz -C /usr/local/bin kujo \
 && chmod 0755 /usr/local/bin/kujo \
 && /usr/local/bin/kujo --version \
 && rm /tmp/kujo.tar.gz
RUN groupadd --gid 65532 workcell \
 && useradd --uid 65532 --gid 65532 --no-create-home --shell /usr/sbin/nologin workcell
WORKDIR /workspace
USER 65532:65532
CMD ["kujo", "--version"]
