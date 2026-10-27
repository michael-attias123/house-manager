# State lives in the Cloudflare R2 bucket created during bootstrap (and
# imported as cloudflare_r2_bucket.state). The s3 backend works the same in
# OpenTofu and Terraform (>= 1.10 for use_lockfile).
#
# Nothing secret here. The backend reads from the environment:
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   R2 access key (bootstrap item 2)
#   AWS_ENDPOINT_URL_S3                         https://<account_id>.r2.cloudflarestorage.com
#
# Backend blocks cannot use variables, so the bucket name repeats
# var.state_bucket_name (prod.auto.tfvars); keep the two equal.
terraform {
  backend "s3" {
    bucket = "house-manager-tfstate"
    key    = "prod/terraform.tfstate"
    region = "auto"

    use_path_style = true
    # Lock with a conditional write of <key>.tflock (R2 supports If-None-Match).
    use_lockfile = true

    # R2 is not AWS: no STS, no IMDS, no AWS regions, no newer S3 checksums.
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_s3_checksum            = true
  }
}
