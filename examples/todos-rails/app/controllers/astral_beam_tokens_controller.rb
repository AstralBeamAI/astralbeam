class AstralBeamTokensController < ApplicationController
  # Matches the seeded Tenant and TenantUser. A real app derives both from its session, for example
  # { id: Current.user.id.to_s, name: Current.user.name } after Rails' authentication generator.
  DEMO_USER = { id: "todos-user-1", name: "Ada Lovelace", admin: true, metadata: { email: "ada@example.com" } }.freeze
  DEMO_TENANT = { id: "todos-tenant-1", name: "Todos Example" }.freeze

  def create
    # A cached token would outlive its short expiry.
    no_store
    api_key = Rails.configuration.x.astralbeam.api_key
    # This action hands the fixed demo identity to any caller, so it never runs in production.
    if Rails.env.production?
      render json: { error: "The demo token route is disabled in production" }, status: :service_unavailable
    elsif api_key.nil?
      render json: { error: "The AstralBeam API key is not configured" }, status: :service_unavailable
    else
      render json: { token: AstralBeam.token(api_key:, user: DEMO_USER, tenant: DEMO_TENANT) }
    end
  rescue ArgumentError
    # The message describes the API key's shape. Never send it to a client.
    render json: { error: "The chat auth token could not be created" }, status: :internal_server_error
  end
end
