from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .viewsets import (
    AbsenceCategoryViewSet,
    AbsenceViewSet,
    EmployeeViewSet,
    SaturdayShiftViewSet,
    WeeklyPlanCategoryViewSet,
    WeeklyPlanViewSet,
)

router = DefaultRouter()
router.register(r"employees", EmployeeViewSet, basename="employees")
router.register(
    r"weekly_plan_categories",
    WeeklyPlanCategoryViewSet,
    basename="weekly_plan_categories",
)
router.register(
    r"absence_categories",
    AbsenceCategoryViewSet,
    basename="absence_categories",
)
# Grid/aggregate endpoint (not a CRUD collection) — singular resource name.
router.register(r"weekly_plan", WeeklyPlanViewSet, basename="weekly_plan")
router.register(r"absences", AbsenceViewSet, basename="absences")
router.register(r"saturday_shifts", SaturdayShiftViewSet, basename="saturday_shifts")


urlpatterns = [
    path("", include(router.urls)),
]
