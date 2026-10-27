#!/usr/bin/env bash
# Encrypts the infrastructure secrets into infra/secrets.enc.yaml (SOPS + age).
#
# Run it on your own machine. The values are typed or pasted here and go
# straight into sops; they are never passed as command-line arguments (so they
# stay out of shell history and `ps`), and the only plaintext copy is a 0600
# temp file that is removed on exit.
#
#   infra/scripts/encrypt-secrets.sh             create secrets.enc.yaml (asks for every key)
#   infra/scripts/encrypt-secrets.sh --force     same, replacing an existing file
#   infra/scripts/encrypt-secrets.sh --set KEY   change one value (from stdin or a prompt)
#   infra/scripts/encrypt-secrets.sh --check     decrypt to /dev/null, list and validate the keys
#
# Without a terminal (stdin is a pipe or a file), create mode reads one value per
# line in the order of KEYS below; an empty push_secret line generates one.
# Works with the bash 3.2 that ships with macOS.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA_DIR=$(dirname "$SCRIPT_DIR")
SOPS_CONFIG=$INFRA_DIR/.sops.yaml
SECRETS_FILE=$INFRA_DIR/secrets.enc.yaml
PLACEHOLDER=age1REPLACE_ME

# The exact keys of secrets.enc.yaml (infra/secrets.example.yaml documents each one).
KEYS=(
  vapid_public_key
  vapid_private_key
  vapid_subject
  push_secret
  google_client_id
  google_client_secret
  supabase_db_password
  supabase_db_url
)

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
warn() { printf 'warning: %s\n' "$*" >&2; }
say() { printf '%s\n' "$*" >&2; }

# Prints the header comment above.
usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
}

# ---------------------------------------------------------------- key metadata

is_known_key() {
  local k
  for k in "${KEYS[@]}"; do [[ $k == "$1" ]] && return 0; done
  return 1
}

# Secret keys are read without echo.
is_secret() {
  case $1 in
    vapid_private_key | push_secret | google_client_secret | supabase_db_password | supabase_db_url) return 0 ;;
    *) return 1 ;;
  esac
}

describe() {
  case $1 in
    vapid_public_key) echo 'VAPID public key: "Public Key" from "npx web-push generate-vapid-keys" (87 chars, base64url)' ;;
    vapid_private_key) echo 'VAPID private key: "Private Key" from the same run (43 chars, base64url)' ;;
    vapid_subject) echo 'VAPID subject: mailto:you@example.com or https://... (push services contact it on problems)' ;;
    push_secret) echo 'Push secret: shared by the database and the send-push function, at least 32 chars' ;;
    google_client_id) echo 'Google OAuth client ID: Google Cloud console, Credentials (ends with .apps.googleusercontent.com)' ;;
    google_client_secret) echo 'Google OAuth client secret: same page as the client ID' ;;
    supabase_db_password) echo 'Supabase database password: the one chosen when the project was created' ;;
    supabase_db_url) echo 'Supabase Session pooler URL, with the password: postgresql://postgres.<ref>:<password>@...:5432/postgres' ;;
  esac
}

# --------------------------------------------------------------- validation
# Each check prints a reason and returns 1. A reason never contains the value.

validate() {
  local key=$1 v=$2
  if [[ -z $v ]]; then say "$key: empty"; return 1; fi
  if [[ $v == *[[:cntrl:]]* ]]; then say "$key: contains a control character (a stray newline or tab?)"; return 1; fi
  if [[ $v =~ ^[[:space:]] || $v =~ [[:space:]]$ ]]; then say "$key: starts or ends with whitespace"; return 1; fi
  if [[ $v == *REPLACE_ME* ]]; then say "$key: still a REPLACE_ME placeholder"; return 1; fi
  if [[ $key != supabase_db_password && $v =~ [[:space:]] ]]; then say "$key: contains whitespace"; return 1; fi

  case $key in
    vapid_public_key)
      if [[ $v == *=* ]]; then say "$key: contains '=' padding; use the base64url key exactly as web-push prints it"; return 1; fi
      if [[ ! $v =~ ^[A-Za-z0-9_-]+$ ]]; then say "$key: not base64url (only A-Z a-z 0-9 - _ are allowed)"; return 1; fi
      if ((${#v} != 87)); then say "$key: must be 87 characters, got ${#v}"; return 1; fi
      # An uncompressed P-256 point starts with byte 0x04, which is "B" in base64.
      if [[ $v != B* ]]; then say "$key: does not look like a public key (it should start with B); were the two keys swapped?"; return 1; fi
      ;;
    vapid_private_key)
      if [[ $v == *=* ]]; then say "$key: contains '=' padding; use the base64url key exactly as web-push prints it"; return 1; fi
      if [[ ! $v =~ ^[A-Za-z0-9_-]+$ ]]; then say "$key: not base64url (only A-Z a-z 0-9 - _ are allowed)"; return 1; fi
      if ((${#v} != 43)); then say "$key: must be 43 characters, got ${#v}; were the two keys swapped?"; return 1; fi
      ;;
    vapid_subject)
      if [[ $v =~ ^mailto:[^@]+@[^@]+\.[^@]+$ || $v =~ ^https://[^/]+\.[^/]+ ]]; then :; else
        say "$key: must be mailto:<address> or an https:// URL"; return 1
      fi
      ;;
    push_secret)
      if ((${#v} < 32)); then say "$key: must be at least 32 characters, got ${#v}"; return 1; fi
      ;;
    google_client_id)
      if [[ $v != *.apps.googleusercontent.com ]]; then say "$key: must end with .apps.googleusercontent.com"; return 1; fi
      ;;
    supabase_db_url)
      if [[ ! $v =~ ^postgres(ql)?:// ]]; then say "$key: must start with postgresql:// (or postgres://)"; return 1; fi
      if [[ $v == *'[YOUR-PASSWORD]'* ]]; then say "$key: replace [YOUR-PASSWORD] with the database password"; return 1; fi
      if [[ $v == *@db.*.supabase.co[:/]* ]]; then warn "$key: this looks like the Direct connection (IPv6 only); GitHub Actions needs the Session pooler URL"; fi
      ;;
  esac
  return 0
}

# Checks across keys. Warnings only, since both can legitimately differ.
# Arguments: values in KEYS order.
cross_check() {
  local pub=$1 priv=$2 dbpass=$7 dburl=$8
  if [[ -n $pub && $pub == "$priv" ]]; then warn 'vapid_public_key and vapid_private_key are the same'; fi
  if [[ -n $dbpass && -n $dburl && $dburl != *"$dbpass"* ]]; then
    warn 'supabase_db_url does not contain supabase_db_password (fine if it is URL-encoded there; otherwise one of them is out of date)'
  fi
  return 0
}

# ------------------------------------------------------------------ tooling

require_tools() {
  local missing=0
  if ! command -v sops >/dev/null 2>&1; then missing=1; fi
  if ! command -v age >/dev/null 2>&1 || ! command -v age-keygen >/dev/null 2>&1; then missing=1; fi
  if ((missing)); then
    say 'sops and age are required. Install them:'
    say '  macOS:        brew install sops age'
    say '  Linux:        your package manager (apt install age; sops from https://github.com/getsops/sops/releases)'
    say '  Windows:      use WSL (Ubuntu), then follow the Linux line'
    die 'sops or age not found on PATH'
  fi
  # Captured first: `| grep -q` would SIGPIPE sops and fail under pipefail.
  local help
  help=$(sops set --help 2>&1 || true)
  if [[ $help != *--value-stdin* ]]; then
    die 'sops 3.10 or newer is required (for "sops set --value-stdin"); upgrade sops'
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    warn 'openssl not found; push_secret cannot be generated here'
  fi
}

# Prints the age recipients from .sops.yaml, one per line. Refuses the placeholder.
read_recipients() {
  [[ -f $SOPS_CONFIG ]] || die "$SOPS_CONFIG not found"
  local recipients
  recipients=$(grep -v '^[[:space:]]*#' "$SOPS_CONFIG" | grep -o 'age1[A-Za-z0-9_]*' || true)
  if [[ -z $recipients || $recipients == *"$PLACEHOLDER"* ]]; then
    say "infra/.sops.yaml still has the placeholder recipient ($PLACEHOLDER)."
    say 'Create your age key (once), then put its public key ("age1...") in infra/.sops.yaml:'
    say '  mkdir -p ~/.config/sops/age'
    say '  age-keygen -o ~/.config/sops/age/keys.txt    # prints "Public key: age1..."'
    say '  age-keygen -y ~/.config/sops/age/keys.txt    # prints it again later'
    say 'Keep keys.txt in your password manager too: without it nobody can decrypt the secrets.'
    die 'no age recipient configured'
  fi
  local r
  while IFS= read -r r; do
    [[ $r =~ ^age1[a-z0-9]+$ ]] || die "infra/.sops.yaml: '$r' is not a valid age public key"
  done <<<"$recipients"
  printf '%s\n' "$recipients"
}

# Makes the local age private key visible to sops, if there is one.
# sops looks in os.UserConfigDir (~/Library/Application Support on macOS);
# age-keygen -o ~/.config/... is the documented path, so point sops there.
find_private_key() {
  if [[ -n ${SOPS_AGE_KEY:-} ]]; then return 0; fi
  if [[ -n ${SOPS_AGE_KEY_FILE:-} ]]; then
    [[ -f $SOPS_AGE_KEY_FILE ]] || die "SOPS_AGE_KEY_FILE points to a missing file"
    return 0
  fi
  local f
  for f in "${XDG_CONFIG_HOME:-$HOME/.config}/sops/age/keys.txt" "$HOME/Library/Application Support/sops/age/keys.txt"; do
    if [[ -f $f ]]; then
      export SOPS_AGE_KEY_FILE=$f
      return 0
    fi
  done
  return 1
}

# Public keys of the local private key(s), one per line.
local_public_keys() {
  if [[ -n ${SOPS_AGE_KEY:-} ]]; then
    printf '%s\n' "$SOPS_AGE_KEY" | age-keygen -y 2>/dev/null || true
  else
    age-keygen -y "$SOPS_AGE_KEY_FILE" 2>/dev/null || true
  fi
}

require_private_key() {
  find_private_key || die 'no age private key: set SOPS_AGE_KEY_FILE, or create ~/.config/sops/age/keys.txt (see infra/BOOTSTRAP.md)'
}

# Warns when the local key cannot decrypt for the configured recipients.
check_key_matches() {
  local recipients=$1 mine
  if ! find_private_key; then
    warn 'no local age private key found, so the result cannot be test-decrypted here; keep the private key safe'
    return 0
  fi
  mine=$(local_public_keys)
  local r
  while IFS= read -r r; do
    if [[ -n $r ]] && grep -qxF "$r" <<<"$recipients"; then return 0; fi
  done <<<"$mine"
  warn 'your local age key is not one of the recipients in infra/.sops.yaml; you will not be able to decrypt the file'
}

# ------------------------------------------------------------------ temp files

TMP_FILES=()
cleanup() {
  local f
  # ${arr[@]+...} keeps bash 3.2 quiet under set -u when the array is empty.
  for f in ${TMP_FILES[@]+"${TMP_FILES[@]}"}; do rm -f -- "$f"; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# ------------------------------------------------------------------ input

INTERACTIVE=0
[[ -t 0 ]] && INTERACTIVE=1

# Reads one value for $1 into VALUE. Re-asks on a terminal, fails otherwise.
VALUE=
ask() {
  local key=$1 v answer
  while :; do
    v=
    if ((INTERACTIVE)); then
      say ''
      say "$(describe "$key")"
      if [[ $key == push_secret ]] && command -v openssl >/dev/null 2>&1; then
        printf '%s' 'Generate a new push_secret with "openssl rand -hex 32"? [Y/n] ' >&2
        IFS= read -r answer || answer=n
        if [[ -z $answer || $answer == [Yy]* ]]; then
          v=$(openssl rand -hex 32)
          say '(generated 64 characters)'
        fi
      fi
      if [[ -z $v ]]; then
        printf '%s: ' "$key" >&2
        if is_secret "$key"; then
          IFS= read -rs v || die "no input for $key"
          say ''
          say "(received ${#v} characters)"
        else
          IFS= read -r v || die "no input for $key"
        fi
      fi
    else
      IFS= read -r v || die "no input for $key (expected one line per key, in the order of KEYS)"
      if [[ -z $v && $key == push_secret ]]; then
        command -v openssl >/dev/null 2>&1 || die 'push_secret is empty and openssl is missing'
        v=$(openssl rand -hex 32)
      fi
    fi
    if validate "$key" "$v"; then
      VALUE=$v
      return 0
    fi
    ((INTERACTIVE)) || die "$key is invalid (see above); nothing was written"
    say 'Try again (Ctrl-C to stop; nothing has been written).'
  done
}

# Single-quoted YAML scalar: only ' needs escaping (as ''). Values have no
# control characters, so this cannot break the document.
yaml_quote() {
  local s=$1
  printf "'%s'" "${s//\'/\'\'}"
}

# JSON string for `sops set` (no control characters, so only \ and " to escape).
json_quote() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

print_vapid_hint() {
  ((INTERACTIVE)) || return 0
  say 'VAPID keys: if push notifications already work, reuse the current pair'
  say '(new keys make every phone turn notifications on again). For a new pair:'
  say '  npx web-push generate-vapid-keys'
}

# ------------------------------------------------------------------ modes

mode_create() {
  local force=$1 recipients
  recipients=$(read_recipients)
  if [[ -e $SECRETS_FILE && $force != 1 ]]; then
    die "$SECRETS_FILE already exists; use --set KEY to change one value, or --force to replace it"
  fi
  check_key_matches "$recipients"

  if ((INTERACTIVE)); then
    say "Encrypting for: $(tr '\n' ' ' <<<"$recipients")"
    say 'Secret values are not echoed. Paste each one and press Enter.'
  fi
  print_vapid_hint

  local values=() key
  for key in "${KEYS[@]}"; do
    ask "$key"
    values+=("$VALUE")
  done
  VALUE=
  cross_check "${values[@]}"

  umask 077
  local plain enc i
  plain=$(mktemp "${TMPDIR:-/tmp}/hm-secrets.XXXXXXXX")
  TMP_FILES+=("$plain")
  enc=$(mktemp "$INFRA_DIR/.secrets.enc.XXXXXXXX")
  TMP_FILES+=("$enc")

  # No comments: sops would carry them (encrypted) into the output.
  {
    for ((i = 0; i < ${#KEYS[@]}; i++)); do
      printf '%s: %s\n' "${KEYS[i]}" "$(yaml_quote "${values[i]}")"
    done
  } >"$plain"
  values=()

  sops --config "$SOPS_CONFIG" --encrypt \
    --input-type yaml --output-type yaml \
    --filename-override "$SECRETS_FILE" \
    "$plain" >"$enc"
  rm -f -- "$plain"
  chmod 644 "$enc"
  mv -f -- "$enc" "$SECRETS_FILE"

  say ''
  say "Wrote ${SECRETS_FILE#"$(dirname "$INFRA_DIR")/"} (${#KEYS[@]} keys)."
  if find_private_key; then
    if sops --config "$SOPS_CONFIG" --decrypt "$SECRETS_FILE" >/dev/null 2>&1; then
      say 'Test decryption with your local key: ok.'
    else
      warn 'your local key cannot decrypt the new file; check infra/.sops.yaml'
    fi
  fi
  say 'Next: git add infra/.sops.yaml infra/secrets.enc.yaml, commit, and open a PR (infra/BOOTSTRAP.md).'
}

mode_set() {
  local key=$1
  is_known_key "$key" || die "unknown key '$key'; expected one of: ${KEYS[*]}"
  [[ -f $SECRETS_FILE ]] || die "$SECRETS_FILE does not exist; run without arguments to create it"
  read_recipients >/dev/null
  require_private_key

  if [[ $key == vapid_public_key || $key == vapid_private_key ]]; then print_vapid_hint; fi
  ask "$key" # one line from stdin, or a prompt on a terminal
  local json
  json=$(json_quote "$VALUE")
  VALUE=
  # The value goes through a pipe from a builtin, never through argv.
  printf '%s' "$json" | sops --config "$SOPS_CONFIG" set --value-stdin "$SECRETS_FILE" "[\"$key\"]"
  json=
  sops --config "$SOPS_CONFIG" --decrypt "$SECRETS_FILE" >/dev/null || die 'the file no longer decrypts'
  say "Updated $key."
  case $key in
    supabase_db_password) say 'Note: this does not change the password in Supabase. Change it there first, then update supabase_db_url too.' ;;
    vapid_public_key | vapid_private_key) say 'Note: change both VAPID keys together; after apply, every phone turns notifications on again.' ;;
  esac
  say 'Commit infra/secrets.enc.yaml and open a PR; the plan shows which resources get the new value.'
}

mode_check() {
  [[ -f $SECRETS_FILE ]] || die "$SECRETS_FILE does not exist"
  require_private_key
  sops --config "$SOPS_CONFIG" --decrypt "$SECRETS_FILE" >/dev/null || die 'decryption failed (wrong key, or the file was edited by hand)'
  say "Decrypts: ok ($SECRETS_FILE)"

  # Keys are stored in clear in a SOPS file; only the values are encrypted.
  local present
  present=$(grep -oE '^[A-Za-z0-9_]+:' "$SECRETS_FILE" | tr -d ':' | grep -vx 'sops' || true)

  local problems=0 key v values=() reason
  for key in "${KEYS[@]}"; do
    if ! grep -qxF "$key" <<<"$present"; then
      printf '  %-22s MISSING\n' "$key" >&2
      problems=1
      values+=("")
      continue
    fi
    v=$(sops --config "$SOPS_CONFIG" --decrypt --extract "[\"$key\"]" "$SECRETS_FILE")
    if reason=$(validate "$key" "$v" 2>&1); then
      printf '  %-22s ok\n' "$key" >&2
    else
      printf '  %-22s INVALID: %s\n' "$key" "${reason#"$key": }" >&2
      problems=1
    fi
    values+=("$v")
  done
  v=
  while IFS= read -r key; do
    [[ -z $key ]] && continue
    is_known_key "$key" || { printf '  %-22s unexpected (not used by infra/)\n' "$key" >&2; problems=1; }
  done <<<"$present"
  cross_check "${values[@]}"
  values=()
  ((problems == 0)) || die 'secrets.enc.yaml has problems (see above)'
  say 'All keys present and valid.'
}

# ------------------------------------------------------------------ main

main() {
  local mode=create force=0 set_key=
  while (($#)); do
    case $1 in
      --force) force=1 ;;
      --set)
        [[ $# -ge 2 ]] || die '--set needs a KEY (the value is read from stdin or a prompt, never from the command line)'
        mode="set"
        set_key=$2
        shift
        ;;
      --set=*) die 'give the KEY as --set KEY; the value is read from stdin or a prompt' ;;
      --check) mode=check ;;
      -h | --help) usage; exit 0 ;;
      *) usage >&2; die "unknown argument: $1" ;;
    esac
    shift
  done
  if [[ $mode != create && $force == 1 ]]; then die '--force only applies to create mode'; fi

  require_tools
  case $mode in
    create) mode_create "$force" ;;
    set) mode_set "$set_key" ;;
    check) mode_check ;;
  esac
}

main "$@"
