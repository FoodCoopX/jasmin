#!/bin/sh
set -e

cd jasmin-core/react-core
npm install
cd ../..

make generate-frontend-api

rm -rf /home/theo/PycharmProjects/jasmin/jasmin-core/react-core/dist
cd jasmin-core/react-core
npm run build:dev
cd ../..

make poetry-build
rm -f ./jasmin_django_core-0.1.0-py3-none-any.whl
cp jasmin-core/django-core/dist/jasmin_django_core-0.1.0-py3-none-any.whl ./jasmin_django_core-0.1.0-py3-none-any.whl