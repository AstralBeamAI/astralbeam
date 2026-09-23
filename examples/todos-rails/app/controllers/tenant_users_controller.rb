class TenantUsersController < ApplicationController
  def index
    @show_admin = params[:show_admin] == "on"
  end
end
