# Resources created outside Terraform and imported as they are use this
# provider: no default_tags, so importing them does not re-tag them.
provider "aws" {
  alias  = "as_is"
  region = var.region
}
