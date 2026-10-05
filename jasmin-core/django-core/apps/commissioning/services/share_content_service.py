"""``ShareContentService``: harvest-share planning.

Composed of three parts, one module each: ``share_content_planning`` (the
planning writes), ``share_content_frontend`` (the planning page's data) and
``share_content_stock`` (totals, theoretical objects and movements, which the
other two build on).
"""

from __future__ import annotations

from .share_content_frontend import ShareContentFrontendData
from .share_content_planning import ShareContentPlanning


class ShareContentService(ShareContentPlanning, ShareContentFrontendData):
    """Service for processing harvest share planning data from frontend."""
