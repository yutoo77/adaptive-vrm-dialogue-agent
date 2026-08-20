# Third-Party Notices

This repository's source code is licensed under the [MIT License](LICENSE). That license does not replace the terms of third-party software, voice libraries, VRM models, or other assets used with the application.

No `node_modules`, Python virtual environment, VOICEVOX Engine, generated voice, speech-recognition model, or VRM model is distributed in this repository.

## Direct runtime dependencies

| Component | Version | License | Project |
| --- | ---: | --- | --- |
| `@pixiv/three-vrm` | 3.5.5 | MIT | [pixiv/three-vrm](https://github.com/pixiv/three-vrm) |
| `three` | 0.185.1 | MIT | [mrdoob/three.js](https://github.com/mrdoob/three.js) |
| FastAPI | 0.141.1 | MIT | [fastapi/fastapi](https://github.com/fastapi/fastapi) |
| faster-whisper | 1.2.1 | MIT | [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| HTTPX | 0.28.1 | BSD-3-Clause | [encode/httpx](https://github.com/encode/httpx) |
| OpenAI Python SDK | 3.0.0 | Apache-2.0 | [openai/openai-python](https://github.com/openai/openai-python) |
| python-multipart | 0.0.32 | Apache-2.0 | [Kludex/python-multipart](https://github.com/Kludex/python-multipart) |
| Uvicorn | 0.52.1 | BSD-3-Clause | [encode/uvicorn](https://github.com/encode/uvicorn) |

Development tools and transitive packages remain subject to the licenses declared by their respective distributions. Versions are fixed in `frontend/package-lock.json` and the Backend requirements files.

## Original interface artwork

The stage background, circular window, lattice, water-ripple lines, floating shapes, palette, and state-responsive lighting are created in this repository with CSS and Three.js primitives. They do not use bundled stock images, downloaded textures, or third-party character artwork.

## VOICEVOX and 冥鳴ひまり

VOICEVOX is optional local software and is not bundled. When the default speaker is used in a published recording or demo, the required credit is:

> VOICEVOX:冥鳴ひまり

Consult both the [VOICEVOX software terms](https://voicevox.hiroshiba.jp/term/) and the [VOICEVOX:冥鳴ひまり terms](https://www.meimeihimari.com/terms-of-use) before publishing generated audio. The local verification record is in [docs/voice-license-record.md](docs/voice-license-record.md).

## VRM model and screenshots

The `AvatarSample_A` VRM used for local verification is not bundled. The public screenshot in `docs/assets/demo-overview.jpg` shows that sample model. Its official conditions permit using images and videos of the sample model and do not require attribution; attribution is included voluntarily:

> AvatarSample_A © pixiv Inc. / pixiv VRoid Project

See the [official AvatarSample A–Z conditions](https://vroid.pixiv.help/hc/ja/articles/4402394424089-AvatarSample-A-Z) and [docs/model-license-record.md](docs/model-license-record.md). Users who load another VRM are responsible for checking that model's terms.
