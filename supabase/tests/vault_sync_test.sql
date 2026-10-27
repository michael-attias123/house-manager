-- Checks what infra/scripts/sync-vault.sh left in the Vault stand-in
-- (vault_stub.sql). scripts/db-test.sh runs the script twice (create, then
-- update) and passes the values of the second run as psql variables.
\o /dev/null
select set_config('test.vault_url', :'expected_url', false),
       set_config('test.vault_secret', :'expected_secret', false);
\o
do $$
begin
  assert (select count(*) from vault.secrets) = 2, format('vault secrets: %s', (select count(*) from vault.secrets));
  assert (select decrypted_secret from vault.decrypted_secrets where name = 'push_function_url')
    = current_setting('test.vault_url'), 'push_function_url not updated';
  assert (select decrypted_secret from vault.decrypted_secrets where name = 'push_secret')
    = current_setting('test.vault_secret'), 'push_secret not updated';
end;
$$;

drop schema vault cascade;
\echo 'Vault sync tests passed'
