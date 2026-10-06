/**
 * DeliveryStationInfoModal: what the members are told about one delivery
 * station — a free-text note, the access code, the messenger group, a contact
 * person and phone, a picture of the pickup spot, whether the station is
 * self-service, and where it is on the map.
 *
 * Rendered the way the delivery station list uses it: the list holds the
 * stations from its query, opens the modal on one of them and lets the station
 * go again when the modal closes or saves. The real modal, form and picture
 * hooks render; the generated commissioning client and the raw API layer the
 * multipart picture upload goes through are the mocking boundary, both
 * answering from an in-memory server.
 *
 * Nothing on this screen reads today's date, so the clock runs free.
 */

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommissioningDeliveryStationsListQueryKey } from "@shared/api/generated/commissioning/commissioning";
import type { DeliveryStation } from "@shared/api/generated/models";
import i18n from "@shared/i18n";
import {
  flushMicrotasks,
  profileRenders,
  type ProfileRendersHandle,
} from "@/test/profileRenders";

// The canonical mock, with one `t` for every render as react-i18next keeps it.
const i18nMock = vi.hoisted(() => ({
  t: (key: string, fallback?: unknown) =>
    typeof fallback === "string" ? fallback : key,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: i18nMock.t,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  validationError: vi.fn(),
}));
vi.mock("@shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils")>()),
  notify,
}));

const api = vi.hoisted(() => ({
  stations: vi.fn<() => Promise<DeliveryStation[]>>(),
  update: vi.fn<
    (id: string, station: Partial<DeliveryStation>) => Promise<DeliveryStation>
  >(),
  patchPicture: vi.fn<
    (
      url: string,
      body: unknown,
      config?: unknown,
    ) => Promise<{ data: DeliveryStation }>
  >(),
}));

vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  getCommissioningDeliveryStationsListQueryKey: (params?: unknown) => [
    "/api/commissioning/delivery_stations/",
    ...(params ? [params] : []),
  ],
  commissioningDeliveryStationsPartialUpdate: (
    id: string,
    station: Partial<DeliveryStation>,
  ) => api.update(id, station),
}));

// The picture is sent as multipart form data, which the generated JSON client
// can't carry, so it goes through the raw axios instance.
vi.mock("@shared/services/api", () => ({
  default: { patch: api.patchPicture },
}));

import DeliveryStationInfoModal from "../DeliveryStationInfoModal";

// ── Fixtures ────────────────────────────────────────────────────────────────

const MEDIA = "https://media.example/pictures_delivery_station";

// A station with everything filled in, as the server sends it: coordinates
// with the ten decimals the backend keeps.
const MILL: DeliveryStation = {
  id: "station-mill",
  short_name: "Mill",
  info: "The crates are in the barn behind the mill.",
  access_code: "4711",
  messenger_group_link: "https://signal.group/#mill-pickup",
  contact_name: "Hanna Berger",
  contact_phone: "+43 660 1234567",
  picture: `${MEDIA}/mill.jpg`,
  photo_link: "https://photos.example/mill",
  self_service: true,
  coords_lat: "48.2082000000",
  coords_lon: "16.3738000000",
};

// A station the members have not been told anything about yet.
const BAKERY: DeliveryStation = {
  id: "station-bakery",
  short_name: "Bakery",
  info: null,
  access_code: null,
  messenger_group_link: null,
  contact_name: null,
  contact_phone: null,
  picture: null,
  photo_link: null,
  self_service: false,
  coords_lat: null,
  coords_lon: null,
};

// What a save sends for each station when nothing is changed.
const MILL_AS_SHOWN = {
  info: "The crates are in the barn behind the mill.",
  access_code: "4711",
  messenger_group_link: "https://signal.group/#mill-pickup",
  contact_name: "Hanna Berger",
  contact_phone: "+43 660 1234567",
  self_service: true,
  coords_lat: "48.2082000000",
  coords_lon: "16.3738000000",
};
const BAKERY_AS_SHOWN = {
  info: "",
  access_code: "",
  messenger_group_link: "",
  contact_name: "",
  contact_phone: "",
  self_service: false,
  coords_lat: null,
  coords_lon: null,
};

// A Google-Maps place link: the map is centred near the place, and the place's
// own pin sits in the data part.
const PLACE_LINK =
  "https://www.google.com/maps/place/Alte+M%C3%BChle/@48.2100000,16.3600000,17z" +
  "/data=!3m1!4b1!4m6!3m5!1s0x476d079e5136ca9f:0xfdc2e58a51a25b46!8m2" +
  "!3d48.2082123!4d16.3738456!16s%2Fg%2F11c1q2w3e4";

// What the server currently holds; the list and both saves work on it.
let serverStations: DeliveryStation[] = [];

function saveOnServer(
  id: string,
  patch: Partial<DeliveryStation>,
): DeliveryStation {
  const current = serverStations.find((station) => station.id === id);
  if (!current) throw new Error(`No delivery station ${id}`);
  const saved = { ...current, ...patch };
  serverStations = serverStations.map((station) =>
    station.id === id ? saved : station,
  );
  return saved;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The delivery station list, as far as the member information goes. */
function StationList({
  onClose,
  onSaved,
  profiler,
}: {
  onClose: () => void;
  onSaved: () => void;
  profiler: ProfileRendersHandle;
}) {
  const { data: stations = [] } = useQuery({
    queryKey: getCommissioningDeliveryStationsListQueryKey(),
    queryFn: () => api.stations(),
  });
  const [infoStation, setInfoStation] = useState<DeliveryStation | null>(null);
  return (
    <>
      {stations.map((station) => (
        <button
          key={station.id}
          type="button"
          onClick={() => setInfoStation(station)}
        >
          {`Member info for ${station.short_name}`}
        </button>
      ))}
      {profiler.wrap(
        <DeliveryStationInfoModal
          open={!!infoStation}
          deliveryStation={infoStation}
          onClose={() => {
            onClose();
            setInfoStation(null);
          }}
          onSaved={() => {
            onSaved();
            setInfoStation(null);
          }}
        />,
      )}
    </>
  );
}

function renderList() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const profiler = profileRenders();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <StationList onClose={onClose} onSaved={onSaved} profiler={profiler} />
    </QueryClientProvider>,
  );
  return { onClose, onSaved, profiler };
}

/** Opens the member information of the station with this short name. */
async function openStation(shortName: string): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByRole("button", { name: `Member info for ${shortName}` }),
  );
  return screen.findByRole("dialog");
}

async function renderOpen(shortName = "Mill") {
  const list = renderList();
  await openStation(shortName);
  return list;
}

const INFO = "delivery_stations.info";
const ACCESS_CODE = "delivery_stations.access_code";
const MESSENGER_LINK = "delivery_stations.messenger_group_link";
const CONTACT_NAME = "delivery_stations.contact_name";
const CONTACT_PHONE = "delivery_stations.contact_phone";
const LAT = "delivery_stations.coords_lat";
const LON = "delivery_stations.coords_lon";
const INVALID_COORDINATE = "delivery_stations.invalid_coordinate";

// The picture buttons carry their icon's name ahead of their text.
const UPLOAD = /common\.upload$/;
const REPLACE = /common\.replace$/;
const DELETE = /common\.delete$/;

const dialog = () => screen.getByRole("dialog");

const field = (label: string) => within(dialog()).getByLabelText(label);

const selfService = () =>
  within(dialog()).getByRole("switch", { name: "delivery_stations.self_service" });

const mapsLinkField = () =>
  within(dialog()).getByRole("textbox", { name: "delivery_stations.paste_maps_link" });

async function retype(label: string, text: string) {
  const input = field(label);
  await userEvent.clear(input);
  await userEvent.type(input, text);
}

async function pasteMapsLink(text: string) {
  await userEvent.click(mapsLinkField());
  await userEvent.paste(text);
}

// While it spins, the save button's name starts with its loading icon's.
const saveButton = () => within(dialog()).getByRole("button", { name: /common\.save$/ });

async function save() {
  await userEvent.click(saveButton());
}

async function cancel() {
  await userEvent.click(within(dialog()).getByRole("button", { name: "common.cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

const pictureButton = (name: RegExp) => within(dialog()).getByRole("button", { name });

const queryPictureButton = (name: RegExp) =>
  within(dialog()).queryByRole("button", { name });

/** The address of the picture shown, or null when there is none. */
const shownPicture = () => dialog().querySelector("img")?.getAttribute("src") ?? null;

function fileInput(): HTMLInputElement {
  const input = dialog().querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The picture field has no file input");
  return input;
}

const porchPicture = () => new File(["jpeg"], "porch.jpg", { type: "image/jpeg" });

beforeEach(() => {
  Object.values(notify).forEach((spy) => spy.mockClear());
  serverStations = [MILL, BAKERY];
  api.stations
    .mockReset()
    .mockImplementation(async () => serverStations.map((station) => ({ ...station })));
  api.update.mockReset().mockImplementation(async (id, patch) => saveOnServer(id, patch));
  // The server stores an uploaded picture under its file name.
  api.patchPicture.mockReset().mockImplementation(async (url, body) => {
    const id = url.split("/").filter(Boolean).pop() ?? "";
    const picture =
      body instanceof FormData ? `${MEDIA}/${(body.get("picture") as File).name}` : null;
    return { data: saveOnServer(id, { picture }) };
  });
});

// ── What the office sees ────────────────────────────────────────────────────

describe("DeliveryStationInfoModal contents", () => {
  it("shows nothing until the office opens a station", async () => {
    renderList();

    expect(
      await screen.findByRole("button", { name: "Member info for Mill" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is titled after the station's short name and says who the information is for", async () => {
    await renderOpen();

    expect(
      await screen.findAllByText("delivery_stations.member_info_title — Mill"),
    ).not.toHaveLength(0);
    expect(
      within(dialog()).getByText("delivery_stations.member_info_intro"),
    ).toBeInTheDocument();
  });

  it("shows the station's note, access code, messenger group, contact, self-service and coordinates", async () => {
    await renderOpen();

    expect(field(INFO)).toHaveValue("The crates are in the barn behind the mill.");
    expect(field(ACCESS_CODE)).toHaveValue("4711");
    expect(field(MESSENGER_LINK)).toHaveValue("https://signal.group/#mill-pickup");
    expect(field(CONTACT_NAME)).toHaveValue("Hanna Berger");
    expect(field(CONTACT_PHONE)).toHaveValue("+43 660 1234567");
    expect(selfService()).toBeChecked();
    expect(field(LAT)).toHaveValue("48.2082000000");
    expect(field(LON)).toHaveValue("16.3738000000");
    expect(mapsLinkField()).toHaveValue("");
  });

  it("shows empty fields and self-service off for a station without information", async () => {
    await renderOpen("Bakery");

    for (const label of [INFO, ACCESS_CODE, MESSENGER_LINK, CONTACT_NAME, CONTACT_PHONE, LAT, LON]) {
      expect(field(label)).toHaveValue("");
    }
    expect(selfService()).not.toBeChecked();
  });

  it("shows the station's picture with a button to replace it and one to delete it", async () => {
    await renderOpen();

    await waitFor(() => expect(shownPicture()).toBe(`${MEDIA}/mill.jpg`));
    expect(pictureButton(REPLACE)).toBeInTheDocument();
    expect(pictureButton(DELETE)).toBeInTheDocument();
    expect(queryPictureButton(UPLOAD)).not.toBeInTheDocument();
  });

  it("offers an upload and nothing to delete for a station without a picture", async () => {
    await renderOpen("Bakery");

    expect(shownPicture()).toBeNull();
    expect(pictureButton(UPLOAD)).toBeInTheDocument();
    expect(queryPictureButton(DELETE)).not.toBeInTheDocument();
  });

  it("settles after opening instead of re-rendering in a loop", async () => {
    const { profiler } = await renderOpen();
    await act(() => flushMicrotasks());

    expect(profiler.onRender.mock.calls.length).toBeLessThan(100);
  });
});

// ── Saving ──────────────────────────────────────────────────────────────────

describe("DeliveryStationInfoModal saving", () => {
  it("saves every edited field, says so, closes and reloads the station list", async () => {
    const { onClose, onSaved } = await renderOpen();

    await retype(INFO, "The crates are in the cold room. Please close the door.");
    await retype(ACCESS_CODE, "0815");
    await retype(MESSENGER_LINK, "https://chat.whatsapp.com/MillPickup");
    await retype(CONTACT_NAME, "Jonas Wagner");
    await retype(CONTACT_PHONE, "+43 664 7654321");
    await userEvent.click(selfService());
    await retype(LAT, "47.0707");
    await retype(LON, "15.4395");
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith("station-mill", {
      info: "The crates are in the cold room. Please close the door.",
      access_code: "0815",
      messenger_group_link: "https://chat.whatsapp.com/MillPickup",
      contact_name: "Jonas Wagner",
      contact_phone: "+43 664 7654321",
      self_service: false,
      coords_lat: "47.0707",
      coords_lon: "15.4395",
    });
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith("delivery_stations.info_saved");
    expect(notify.error).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(api.stations).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows what was saved when the station is opened again", async () => {
    const { onClose } = await renderOpen();
    await retype(ACCESS_CODE, "0815");
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    await openStation("Mill");

    expect(field(ACCESS_CODE)).toHaveValue("0815");
  });

  it("saves the station unchanged as the server sent it, coordinates with ten decimals included", async () => {
    const { onClose } = await renderOpen();

    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith("station-mill", MILL_AS_SHOWN);
  });

  it("saves a station without information as empty fields and no coordinates", async () => {
    const { onClose } = await renderOpen("Bakery");

    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith("station-bakery", BAKERY_AS_SHOWN);
  });

  it("removes the coordinates when both fields are emptied", async () => {
    const { onClose } = await renderOpen();

    await userEvent.clear(field(LAT));
    await userEvent.clear(field(LON));
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith("station-mill", {
      ...MILL_AS_SHOWN,
      coords_lat: null,
      coords_lon: null,
    });
  });

  it("saves when Enter is pressed in a field", async () => {
    const { onClose } = await renderOpen();

    await retype(ACCESS_CODE, "0815{Enter}");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith("station-mill", {
      ...MILL_AS_SHOWN,
      access_code: "0815",
    });
  });

  it("can't be cancelled while the save is under way", async () => {
    let answer: (station: DeliveryStation) => void = () => {};
    api.update.mockImplementationOnce(
      () =>
        new Promise<DeliveryStation>((resolve) => {
          answer = resolve;
        }),
    );
    const { onClose } = await renderOpen();
    const button = saveButton();

    await userEvent.click(button);

    await waitFor(() => expect(button).toHaveClass("ant-btn-loading"));
    expect(within(dialog()).getByRole("button", { name: "common.cancel" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    answer(MILL);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("keeps the dialog open with what was typed when the save is refused, and says why", async () => {
    api.update.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: "validation_error",
          message: "Ensure this field has no more than 150 characters.",
          field: "contact_name",
        },
      },
    });
    const { onClose, onSaved } = await renderOpen();
    await retype(CONTACT_NAME, "Jonas Wagner");

    await save();

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        "Ensure this field has no more than 150 characters.",
      ),
    );
    await waitFor(() => expect(saveButton()).not.toHaveClass("ant-btn-loading"));
    expect(notify.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(field(CONTACT_NAME)).toHaveValue("Jonas Wagner");
    expect(api.stations).toHaveBeenCalledTimes(1);

    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenLastCalledWith("station-mill", {
      ...MILL_AS_SHOWN,
      contact_name: "Jonas Wagner",
    });
    expect(notify.success).toHaveBeenCalledWith("delivery_stations.info_saved");
  });

  it("says the save failed in its own words when the server gives no reason", async () => {
    api.update.mockRejectedValueOnce({ isAxiosError: true, response: { status: 502 } });
    const { onClose } = await renderOpen();

    await save();

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("delivery_stations.info_save_error"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });
});

// ── Coordinates ─────────────────────────────────────────────────────────────

describe("DeliveryStationInfoModal coordinates", () => {
  it("takes the place's pin from a pasted Google-Maps link rather than the map's centre", async () => {
    const { onClose } = await renderOpen("Bakery");

    await pasteMapsLink(PLACE_LINK);

    expect(field(LAT)).toHaveValue("48.2082123");
    expect(field(LON)).toHaveValue("16.3738456");
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith("delivery_stations.coordinates_parsed");

    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith("station-bakery", {
      ...BAKERY_AS_SHOWN,
      coords_lat: "48.2082123",
      coords_lon: "16.3738456",
    });
  });

  it("takes the map's centre from a pasted link without a pin", async () => {
    await renderOpen("Bakery");

    await pasteMapsLink("https://www.google.com/maps/@47.0707,15.4395,15z?entry=ttu");

    expect(field(LAT)).toHaveValue("47.0707");
    expect(field(LON)).toHaveValue("15.4395");
    expect(notify.success).toHaveBeenCalledWith("delivery_stations.coordinates_parsed");
  });

  it("replaces the station's coordinates with a pasted latitude and longitude, signs and spaces included", async () => {
    const { onClose } = await renderOpen();

    await pasteMapsLink(" -34.6037 , -58.3816 ");

    expect(field(LAT)).toHaveValue("-34.6037");
    expect(field(LON)).toHaveValue("-58.3816");
    expect(notify.success).toHaveBeenCalledWith("delivery_stations.coordinates_parsed");

    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith("station-mill", {
      ...MILL_AS_SHOWN,
      coords_lat: "-34.6037",
      coords_lon: "-58.3816",
    });
  });

  it("leaves the coordinates alone when the pasted text carries none", async () => {
    await renderOpen();

    // A shortened share link names no coordinates.
    await pasteMapsLink("https://maps.app.goo.gl/x7Yq2Wd9pLmN3");

    expect(field(LAT)).toHaveValue("48.2082000000");
    expect(field(LON)).toHaveValue("16.3738000000");
    expect(notify.success).not.toHaveBeenCalled();
  });

  it("refuses a longitude with three integer digits, pasted ones too, and sends nothing", async () => {
    await renderOpen("Bakery");
    await pasteMapsLink("35.6895, 139.6917");
    expect(field(LON)).toHaveValue("139.6917");

    await save();

    await waitFor(() => expect(field(LON)).toBeInvalid());
    expect(field(LON)).toHaveAccessibleDescription(INVALID_COORDINATE);
    expect(field(LAT)).toBeValid();
    await act(() => flushMicrotasks());
    expect(api.update).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("refuses a decimal comma and an eleventh decimal, and saves once they are corrected", async () => {
    const { onClose } = await renderOpen("Bakery");
    await retype(LAT, "48,2082");
    await retype(LON, "16.37380000001");

    await save();

    await waitFor(() => expect(field(LAT)).toBeInvalid());
    expect(field(LAT)).toHaveAccessibleDescription(INVALID_COORDINATE);
    expect(field(LON)).toBeInvalid();
    expect(field(LON)).toHaveAccessibleDescription(INVALID_COORDINATE);
    await act(() => flushMicrotasks());
    expect(api.update).not.toHaveBeenCalled();

    await retype(LAT, "48.2082");
    await retype(LON, "-16.3738000001");
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith("station-bakery", {
      ...BAKERY_AS_SHOWN,
      coords_lat: "48.2082",
      coords_lon: "-16.3738000001",
    });
  });

  it("lets a pasted link replace a refused coordinate", async () => {
    const { onClose } = await renderOpen();
    await retype(LON, "163.738");
    await save();
    await waitFor(() => expect(field(LON)).toBeInvalid());

    await pasteMapsLink(PLACE_LINK);

    await waitFor(() => expect(field(LON)).toBeValid());
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith("station-mill", {
      ...MILL_AS_SHOWN,
      coords_lat: "48.2082123",
      coords_lon: "16.3738456",
    });
  });
});

// ── Picture ─────────────────────────────────────────────────────────────────

describe("DeliveryStationInfoModal picture", () => {
  it("offers only raster pictures to choose from", async () => {
    await renderOpen();

    expect(fileInput()).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp,image/gif",
    );
  });

  it("uploads a chosen picture on its own, says so and shows it", async () => {
    const { onClose } = await renderOpen("Bakery");
    const porch = porchPicture();

    await userEvent.upload(fileInput(), porch);

    await waitFor(() => expect(shownPicture()).toBe(`${MEDIA}/porch.jpg`));
    expect(api.patchPicture).toHaveBeenCalledTimes(1);
    expect(api.patchPicture).toHaveBeenCalledWith(
      "/api/commissioning/delivery_stations/station-bakery/",
      expect.any(FormData),
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    const sent = api.patchPicture.mock.calls[0][1] as FormData;
    expect(sent.get("picture")).toBe(porch);
    expect(notify.success).toHaveBeenCalledWith("delivery_stations.picture_saved");
    expect(api.stations).toHaveBeenCalledTimes(2);
    expect(pictureButton(REPLACE)).toBeInTheDocument();
    expect(pictureButton(DELETE)).toBeInTheDocument();
    // The picture is stored by itself; the form waits for its own save.
    expect(api.update).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("deletes the picture, says so and offers an upload again", async () => {
    await renderOpen();
    await waitFor(() => expect(shownPicture()).toBe(`${MEDIA}/mill.jpg`));

    await userEvent.click(pictureButton(DELETE));

    await waitFor(() => expect(shownPicture()).toBeNull());
    expect(api.patchPicture).toHaveBeenCalledTimes(1);
    expect(api.patchPicture).toHaveBeenCalledWith(
      "/api/commissioning/delivery_stations/station-mill/",
      { picture: null },
    );
    expect(notify.success).toHaveBeenCalledWith("delivery_stations.picture_saved");
    expect(api.stations).toHaveBeenCalledTimes(2);
    expect(pictureButton(UPLOAD)).toBeInTheDocument();
    expect(queryPictureButton(DELETE)).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("says why the server refused a picture and keeps the one shown", async () => {
    api.patchPicture.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: "commissioning.picture_invalid",
          message: "The picture must be a PNG, JPEG, WEBP or GIF image.",
          field: "picture",
        },
      },
    });
    await renderOpen();
    await waitFor(() => expect(shownPicture()).toBe(`${MEDIA}/mill.jpg`));
    // The file picker can be switched to show every file, so a vector drawing
    // can still be chosen; the server is what refuses it.
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(
      fileInput(),
      new File(["<svg/>"], "plan.svg", { type: "image/svg+xml" }),
    );

    const message = i18n.t("errors.commissioning.picture_invalid");
    expect(message).not.toBe("errors.commissioning.picture_invalid");
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(message));
    expect(notify.success).not.toHaveBeenCalled();
    expect(shownPicture()).toBe(`${MEDIA}/mill.jpg`);
    expect(api.stations).toHaveBeenCalledTimes(1);
  });

  it("says the delete failed in its own words when the server gives no reason, and keeps the picture", async () => {
    api.patchPicture.mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } });
    await renderOpen();
    await waitFor(() => expect(shownPicture()).toBe(`${MEDIA}/mill.jpg`));

    await userEvent.click(pictureButton(DELETE));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("delivery_stations.picture_save_error"),
    );
    expect(notify.success).not.toHaveBeenCalled();
    expect(shownPicture()).toBe(`${MEDIA}/mill.jpg`);
    expect(pictureButton(DELETE)).toBeInTheDocument();
  });
});

// ── Closing and opening again ───────────────────────────────────────────────

describe("DeliveryStationInfoModal closing", () => {
  it("closes from Cancel without saving and drops what was typed", async () => {
    const { onClose, onSaved } = await renderOpen();
    await retype(ACCESS_CODE, "9999");
    await pasteMapsLink("47.0707, 15.4395");

    await cancel();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();

    await openStation("Mill");

    expect(field(ACCESS_CODE)).toHaveValue("4711");
    expect(field(LAT)).toHaveValue("48.2082000000");
    expect(field(LON)).toHaveValue("16.3738000000");
    expect(mapsLinkField()).toHaveValue("");
  });

  it("closes from its close icon without saving", async () => {
    const { onClose } = await renderOpen();

    await userEvent.click(within(dialog()).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("opens for another station with that station's title, information and picture", async () => {
    const { onClose } = await renderOpen();
    await waitFor(() => expect(shownPicture()).toBe(`${MEDIA}/mill.jpg`));
    await retype(CONTACT_NAME, "Jonas Wagner");
    await cancel();

    await openStation("Bakery");

    expect(
      await screen.findAllByText("delivery_stations.member_info_title — Bakery"),
    ).not.toHaveLength(0);
    expect(screen.queryByText("delivery_stations.member_info_title — Mill")).not.toBeInTheDocument();
    expect(field(CONTACT_NAME)).toHaveValue("");
    expect(field(ACCESS_CODE)).toHaveValue("");
    expect(selfService()).not.toBeChecked();
    expect(shownPicture()).toBeNull();
    expect(pictureButton(UPLOAD)).toBeInTheDocument();

    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith("station-bakery", BAKERY_AS_SHOWN);
  });

  it("sends a picture to the station it was opened on after another one", async () => {
    await renderOpen();
    await cancel();
    await openStation("Bakery");

    await userEvent.upload(fileInput(), porchPicture());

    await waitFor(() => expect(shownPicture()).toBe(`${MEDIA}/porch.jpg`));
    expect(api.patchPicture).toHaveBeenCalledTimes(1);
    expect(api.patchPicture.mock.calls[0][0]).toBe(
      "/api/commissioning/delivery_stations/station-bakery/",
    );
  });
});
