FROM rust:1.96.0-alpine3.22@sha256:8c6ab6493f2e93ee7c21781bc599a7e07278aceb15fefb968144d7e4cf8c9a04 AS builder
ARG KUJO_COMMIT=fc0f8bb890d9fbf4fb0a3bb456e1cd2b044fd7a3
RUN apk add --no-cache git musl-dev openssl-dev pkgconfig \
 && git clone https://github.com/kujolang/kujo.git /src/kujo \
 && cd /src/kujo \
 && git checkout "$KUJO_COMMIT" \
 && cargo build --release --locked --no-default-features

FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
RUN addgroup -g 65532 workcell && adduser -D -u 65532 -G workcell workcell
COPY --from=builder /src/kujo/target/release/kujo /usr/local/bin/kujo
WORKDIR /workspace
USER 65532:65532
CMD ["kujo", "--version"]
