#!/bin/sh
set -eu

CERTS_DIR="${CERTS_DIR:-/certs}"

if [ -f "${CERTS_DIR}/ca.crt" ] \
  && [ -f "${CERTS_DIR}/server.crt" ] \
  && [ -f "${CERTS_DIR}/server.key" ]; then
  echo "TLS certificates already present in ${CERTS_DIR}; skipping generation."
  exit 0
fi

mkdir -p "${CERTS_DIR}"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${CERTS_DIR}/ca.key" \
  -out "${CERTS_DIR}/ca.crt" \
  -days 3650 \
  -subj "/CN=Shortlink Local Dev CA"

openssl req -newkey rsa:2048 -nodes \
  -keyout "${CERTS_DIR}/server.key" \
  -out "${CERTS_DIR}/server.csr" \
  -subj "/CN=localhost"

cat > /tmp/server-ext.cnf <<'EOF'
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,IP:127.0.0.1
EOF

openssl x509 -req \
  -in "${CERTS_DIR}/server.csr" \
  -CA "${CERTS_DIR}/ca.crt" \
  -CAkey "${CERTS_DIR}/ca.key" \
  -CAcreateserial \
  -out "${CERTS_DIR}/server.crt" \
  -days 825 \
  -extfile /tmp/server-ext.cnf

rm -f "${CERTS_DIR}/server.csr" "${CERTS_DIR}/ca.srl" /tmp/server-ext.cnf

chmod 644 "${CERTS_DIR}/ca.crt" "${CERTS_DIR}/server.crt"
chmod 600 "${CERTS_DIR}/ca.key" "${CERTS_DIR}/server.key"

echo "TLS certificates generated in ${CERTS_DIR}."
