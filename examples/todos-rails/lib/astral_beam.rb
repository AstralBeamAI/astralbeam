# Mints the tenant token that createAstralBeamToken in @astralbeam/sdk/server mints, with the same checks.
# Wire format: "Mint tokens without JavaScript" at https://app.astralbeam.ai/docs/sdk/authentication
module AstralBeam
  UUID = /\h{8}-\h{4}-\h{4}-\h{4}-\h{12}/
  API_KEY = /\A(?<key_id>key_(?<organization_id>#{UUID})_#{UUID})_(?<secret>abo_[A-Za-z]{64})\z/
  FIELDS = { user: %w[ id name admin metadata ], tenant: %w[ id name metadata ] }.freeze

  def self.token(api_key:, user:, tenant:, expires_in: 5.minutes)
    key = API_KEY.match(api_key) or raise ArgumentError, "api_key must match key_<organizationId>_<id>_abo_<secret>"
    unless expires_in.is_a?(Integer) || expires_in.is_a?(ActiveSupport::Duration)
      raise ArgumentError, "expires_in must be a whole number of seconds"
    end
    raise ArgumentError, "chat auth tokens must live for 60-600 seconds" unless expires_in.to_i.between?(60, 600)
    identity = { user: identity(:user, user), tenant: identity(:tenant, tenant) }
    raise ArgumentError, "user and tenant must not exceed 8192 bytes" if identity.to_json.bytesize > 8192

    now = Time.now.to_i
    payload = { ver: 4, **identity, iss: key[:organization_id], aud: "astralbeam", iat: now, exp: now + expires_in.to_i }
    # AstralBeam stores only the secret's unpadded base64url SHA-256 digest, so that digest is the HMAC key.
    signing_key = Base64.urlsafe_encode64(Digest::SHA256.digest(key[:secret]), padding: false)
    token = JWT.encode(payload, signing_key, "HS256", { typ: "astralbeam+jwt", kid: key[:key_id] })
    raise ArgumentError, "chat auth tokens must not exceed 16384 bytes" if token.bytesize > 16_384
    token
  end

  # Rejects unknown fields rather than dropping them, and omits nil ones, as the SDK does.
  def self.identity(label, value)
    raise ArgumentError, "#{label} must be a hash" unless value.is_a?(Hash)
    value = value.transform_keys(&:to_s).compact
    unknown = value.keys - FIELDS.fetch(label)
    raise ArgumentError, "#{label} has an unknown field \"#{unknown.first}\"" if unknown.any?
    id, name, admin, metadata = value.values_at("id", "name", "admin", "metadata")
    raise ArgumentError, "#{label}.id must be a 1-255 character string" unless id.is_a?(String) && id.length.between?(1, 255)
    raise ArgumentError, "#{label}.name must be a string" unless name.nil? || name.is_a?(String)
    raise ArgumentError, "#{label}.admin must be a boolean" unless admin.nil? || admin == true || admin == false
    raise ArgumentError, "#{label}.metadata must be a JSON object" unless metadata.nil? || (metadata.is_a?(Hash) && json?(metadata))
    value
  end

  def self.json?(value)
    case value
    when nil, true, false, String, Integer then true
    when Float then value.finite?
    when Array then value.all? { |item| json?(item) }
    when Hash then value.all? { |name, item| (name.is_a?(String) || name.is_a?(Symbol)) && json?(item) }
    else false
    end
  end

  private_class_method :identity, :json?
end
