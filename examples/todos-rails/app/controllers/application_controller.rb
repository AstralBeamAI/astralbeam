class ApplicationController < ActionController::Base
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes

  helper_method :color_scheme, :custom_theme?

  private
    # Page toggles live in the query string, so Turbo's morphing page refreshes keep them.
    def color_scheme
      params[:color_scheme].presence_in(%w[ system light dark ]) || "system"
    end

    def custom_theme?
      params[:custom_theme] != "off"
    end
end
