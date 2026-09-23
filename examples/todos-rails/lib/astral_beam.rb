# Mints the tenant token that createAstralBeamToken in @astralbeam/sdk/server mints.
# Wire format: "Mint tokens without JavaScript" at https://app.astralbeam.ai/docs/sdk/authentication
module AstralBeam
  UUID = /\h{8}-\h{4}-\h{4}-\h{4}-\h{12}/
  API_KEY = /\A(?<key_id>key_(?<organization_id>#{UUID})_#{UUID})_(?<secret>abo_[A-Za-z]{64})\z/

  def self.token(api_key:, user:, tenant:, expires_in: 5.minutes)
    key = API_KEY.match(api_key) or raise ArgumentError, "api_key must match key_<organizationId>_<id>_abo_<secret>"
    now = Time.now.to_i
    payload = { ver: 4, user:, tenant:, iss: key[:organization_id], aud: "astralbeam", iat: now, exp: now + expires_in.to_i }
    # AstralBeam stores only the secret's unpadded base64url SHA-256 digest, so that digest is the HMAC key.
    signing_key = Base64.urlsafe_encode64(Digest::SHA256.digest(key[:secret]), padding: false)
    JWT.encode(payload, signing_key, "HS256", { typ: "astralbeam+jwt", kid: key[:key_id] })
  end
end
