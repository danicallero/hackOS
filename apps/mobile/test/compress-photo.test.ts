const mockSizes: number[] = [];
const mockResize = jest.fn();
jest.mock("expo-file-system", () => ({
  File: class {
    size: number;
    constructor() {
      this.size = mockSizes.shift() ?? 1;
    }
  },
}));
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      resize: (size: { width: number; height: number }) => {
        mockResize(size);
        return { renderAsync: async () => mockImage(size.width, size.height) };
      },
      renderAsync: async () => mockImage(4000, 3000),
    }),
  },
}));

const mockSaves: number[] = [];
function mockImage(width: number, height: number) {
  return {
    width,
    height,
    saveAsync: async ({ compress }: { compress: number }) => {
      mockSaves.push(compress);
      return { uri: `file:///${width}-${compress}.jpg` };
    },
  };
}

import { compressPhotoFile, PHOTO_MAX_BYTES } from "@/lib/compress-photo";

const MB = 1024 * 1024;

beforeEach(() => {
  mockSizes.length = 0;
  mockSaves.length = 0;
  mockResize.mockClear();
});

describe("compressPhotoFile (#934, H16)", () => {
  it("keeps the first JPEG that fits the 5 MB cap", async () => {
    mockSizes.push(2 * MB);
    expect(await compressPhotoFile("file:///raw.heic")).toBe("file:///4000-0.8.jpg");
    expect(mockSaves).toEqual([0.8]);
  });

  it("lowers quality, then dimensions, until the photo fits", async () => {
    mockSizes.push(9 * MB, 8 * MB, 7 * MB, 6 * MB, PHOTO_MAX_BYTES);
    expect(await compressPhotoFile("file:///raw.jpg")).toBe("file:///3000-0.65.jpg");
    expect(mockSaves).toEqual([0.8, 0.65, 0.5, 0.8, 0.65]);
    expect(mockResize).toHaveBeenCalledWith({ width: 3000, height: 2250 });
  });
});
