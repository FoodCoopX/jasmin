#!/bin/sh
set -e

cd jasmin-core/react-core
npm install
cd ../..

make generate-frontend-api

# Tapir serves the assets as static files, from the "static" folder of the build
# (see STATICFILES_DIRS in Tapir's settings), so they're built into it.
rm -rf jasmin-core/react-core/dist
cd jasmin-core/react-core
npx vite build --assetsDir static/assets --sourcemap
cd ../..

rm -rf jasmin-core/django-core/apps/static/jasmin-dist
make poetry-build
rm -f ./jasmin_django_core-0.1.0-py3-none-any.whl
cp jasmin-core/django-core/dist/jasmin_django_core-0.1.0-py3-none-any.whl ./jasmin_django_core-0.1.0-py3-none-any.whl
