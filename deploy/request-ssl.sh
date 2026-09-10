#!/usr/bin/env bash
set -euo pipefail

domain="${1:-auth.loopo.cc}"
email="${2:-}"
if [[ -z "$email" ]]; then
  printf '用法：%s <域名> <证书通知邮箱>\n' "$0" >&2
  exit 2
fi

if ! getent ahostsv4 "$domain" >/dev/null; then
  echo "DNS 尚未解析：$domain" >&2
  exit 1
fi

install -d -m 0755 /var/www/letsencrypt/.well-known/acme-challenge
install -D -m 0644 "$(dirname "$0")/nginx-auth.conf" "/etc/nginx/sites-available/$domain"
ln -sfn "/etc/nginx/sites-available/$domain" "/etc/nginx/sites-enabled/$domain"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot --nginx --non-interactive --agree-tos --email "$email" \
  --redirect --hsts --staple-ocsp \
  -d "$domain"

nginx -t
systemctl reload nginx
echo "证书申请并启用完成：$domain"
