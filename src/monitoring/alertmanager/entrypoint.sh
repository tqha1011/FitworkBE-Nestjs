#!/bin/sh
set -eu

# Restrict substitutions to plain email addresses so YAML and sed stay literal.
validate_email() {
  case "$2" in
    ''|@*|*@*@*|*[!a-zA-Z0-9@._+%-]*)
      printf '%s must contain one plain email address.\n' "$1" >&2
      exit 1
      ;;
  esac
  case "$2" in
    ?*@?*.?*) ;;
    *)
      printf '%s must contain one plain email address.\n' "$1" >&2
      exit 1
      ;;
  esac
}

validate_email SMTP_GMAIL_USER "${SMTP_GMAIL_USER:-}"
validate_email ALERT_EMAIL_TO "${ALERT_EMAIL_TO:-}"

if [ ! -r /run/secrets/gmail_app_password ] || ! grep -q '[^[:space:]]' /run/secrets/gmail_app_password; then
  printf '%s\n' 'Mount a readable, nonempty Gmail App Password at /run/secrets/gmail_app_password.' >&2
  exit 1
fi

umask 077
sed \
  -e "s/__SMTP_GMAIL_USER__/${SMTP_GMAIL_USER}/g" \
  -e "s/__ALERT_EMAIL_TO__/${ALERT_EMAIL_TO}/g" \
  /etc/alertmanager/alertmanager.yml > /tmp/alertmanager.yml

# Validate the rendered configuration before opening any listeners.
/bin/amtool check-config /tmp/alertmanager.yml
exec /bin/alertmanager "$@"
