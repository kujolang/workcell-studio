FROM debian:trixie-slim@sha256:abc9cb88a5587630d7f915f47b23b0668fe250fbfc6457aa4d52b534c1bbf73f
ARG KUJO_VERSION=1.6.0
ARG KUJO_COMMIT=44af277848173664f72ca85f2a1b3b98d634ecdd
LABEL org.opencontainers.image.source="https://github.com/kujolang/kujo" \
      org.opencontainers.image.revision="$KUJO_COMMIT" \
      org.opencontainers.image.version="$KUJO_VERSION"
ADD --checksum=sha256:142372a0c89f91ece2017034b71a3e800969ab2cd7b13dd2ee18eb39efac4504 \
    https://github.com/kujolang/kujo/releases/download/v1.6.0/kujo-v1.6.0-linux-x64.tar.gz \
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
