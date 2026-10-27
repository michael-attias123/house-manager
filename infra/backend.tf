# State lives in this project's own Supabase Postgres, table tofu_state.states
# (supabase/migrations/20261028000100_tofu_state.sql), locked with advisory
# locks. The pg backend works the same in OpenTofu and Terraform, and needs
# no storage account or credit card. OpenTofu encrypts the state before it
# is written (encryption.tf), so the table only holds ciphertext.
#
# Nothing secret here. The connection string comes from the environment:
#   PG_CONN_STR   the tofu_state role over the Session pooler (port 5432):
#                 postgresql://tofu_state.<ref>:<password>@<pooler-host>:5432/postgres
#                 (the TF_STATE_PG_CONN secret, bootstrap item 1). Not the
#                 Transaction pooler (6543): its pooled sessions drop the lock.
terraform {
  backend "pg" {
    schema_name = "tofu_state"
    # The table is "states": fixed in Terraform, the default in OpenTofu.

    # The migration creates all three; the role may only read and write rows.
    skip_schema_creation = true
    skip_table_creation  = true
    skip_index_creation  = true
  }
}
