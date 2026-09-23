require "test_helper"

class AstralBeamTokensControllerTest < ActionDispatch::IntegrationTest
  ORGANIZATION_ID = "01990a5d-ac96-774b-b942-6b13c85384cb"
  KEY_ID = "key_#{ORGANIZATION_ID}_01990a5d-ac96-774b-b942-6b13c85384ca"
  SECRET = "abo_#{"a" * 64}"

  test "mints a token AstralBeam verifies with the stored key digest" do
    with_api_key("#{KEY_ID}_#{SECRET}") { post astral_beam_token_path }

    assert_response :success
    assert_equal "no-store", response.headers["Cache-Control"]
    digest = Base64.urlsafe_encode64(Digest::SHA256.digest(SECRET), padding: false)
    claims, header = JWT.decode(response.parsed_body["token"], digest, true,
      algorithm: "HS256", iss: ORGANIZATION_ID, verify_iss: true, aud: "astralbeam", verify_aud: true)
    assert_equal({ "alg" => "HS256", "typ" => "astralbeam+jwt", "kid" => KEY_ID }, header)
    assert_equal 4, claims["ver"]
    assert_equal 300, claims["exp"] - claims["iat"]
    assert_equal "todos-user-1", claims.dig("user", "id")
    assert_equal "todos-tenant-1", claims.dig("tenant", "id")
  end

  test "fails closed without a usable API key" do
    with_api_key(nil) { post astral_beam_token_path }
    assert_response :service_unavailable

    with_api_key("not-a-key") { post astral_beam_token_path }
    assert_response :internal_server_error
    assert_no_match "key_", response.body
  end

  private
    def with_api_key(api_key)
      original = Rails.configuration.x.astralbeam.api_key
      Rails.configuration.x.astralbeam.api_key = api_key
      yield
    ensure
      Rails.configuration.x.astralbeam.api_key = original
    end
end
