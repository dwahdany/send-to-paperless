# Send to Paperless

A quick and easy solution using [Cloudflare Email Workers](https://developers.cloudflare.com/email-routing/email-workers/) to process
emails and turn them into [Paperless-NGX](https://docs.paperless-ngx.com/) documents.

## Setup

You need to set the following variables and secrets on your Worker:

| Type      | Name                    | Description                                                             |
|-----------|-------------------------|-------------------------------------------------------------------------|
| Secret    | CF_ACCESS_CLIENT_ID     | Service token for Cloudflare Access application                         |
| Secret    | CF_ACCESS_CLIENT_SECRET | Service token for Cloudflare Access application                         |
| Secret    | PAPERLESS_API_BASE      | Full path to Paperless API, e.g. `https://paperless.example.com/api`    |
| Secret    | PAPERLESS_TOKEN         | API token for Paperless                                                 |
| Plaintext | POSTMASTER_EMAIL        | Email address validated in Cloudflare to send unprocessable messages to |
| Plaintext | PAPERLESS_DEFAULT_TAG   | (Optional) Tag ID to apply to all uploaded documents                    |
| Plaintext | IGNORED_MIME_TYPES      | (Optional) Comma-separated list of MIME types to skip (e.g. `application/pgp-keys,application/pgp-signature`) |

## Motivation

AKA "But Paperless can read email!"

I didn't have the means to set up an entire separate email inbox and give Paperless credentials. It's super easy to add an email route
via Cloudflare though. So now I can either have `bills@example.com` as the recipient for things that send bills, or forward attachments
myself when the need arises.
