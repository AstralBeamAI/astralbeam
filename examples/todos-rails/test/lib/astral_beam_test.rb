require "test_helper"

# AstralBeam rejects what createAstralBeamToken rejects, so these inputs must fail before signing.
class AstralBeamTest < ActiveSupport::TestCase
  API_KEY = "key_01990a5d-ac96-774b-b942-6b13c85384cb_01990a5d-ac96-774b-b942-6b13c85384ca_abo_#{"a" * 64}"
  USER = { id: "user-1" }.freeze
  TENANT = { id: "tenant-1" }.freeze

  def token(user: USER, tenant: TENANT, **options) = AstralBeam.token(api_key: API_KEY, user:, tenant:, **options)

  def claims(signed) = JWT.decode(signed, nil, false).first

  test "accepts lifetimes of 60 to 600 seconds" do
    assert_equal 60, claims(token(expires_in: 60)).then { |c| c["exp"] - c["iat"] }
    assert_equal 600, claims(token(expires_in: 10.minutes)).then { |c| c["exp"] - c["iat"] }
    [ 1, 59, 601, 90.5 ].each do |expires_in|
      assert_raises(ArgumentError, "expires_in #{expires_in}") { token(expires_in:) }
    end
  end

  test "bounds identity IDs to 1-255 characters" do
    assert_equal "a" * 255, claims(token(user: { id: "a" * 255 })).dig("user", "id")
    [ "", "a" * 256, 42, nil ].each do |id|
      assert_raises(ArgumentError, "user id #{id.inspect}") { token(user: { id: }) }
      assert_raises(ArgumentError, "tenant id #{id.inspect}") { token(tenant: { id: }) }
    end
  end

  test "rejects unknown fields and non-JSON values, and omits nil fields" do
    assert_raises(ArgumentError) { token(user: { id: "u", email: "a@example.com" }) }
    assert_raises(ArgumentError) { token(tenant: { id: "t", admin: true }) }
    assert_raises(ArgumentError) { token(user: { id: "u", admin: "yes" }) }
    assert_raises(ArgumentError) { token(user: { id: "u", metadata: { at: Time.now } }) }
    assert_raises(ArgumentError) { token(tenant: { id: "t", metadata: { ratio: Float::NAN } }) }
    assert_raises(ArgumentError) { token(tenant: { id: "t", metadata: [ 1 ] }) }
    assert_equal({ "id" => "u" }, claims(token(user: { id: "u", name: nil }))["user"])
  end

  test "caps identity JSON at 8 KiB" do
    assert_raises(ArgumentError) { token(user: { id: "u", metadata: { notes: "x" * 8192 } }) }
    assert token(user: { id: "u", metadata: { notes: "x" * 7000 } })
  end
end
