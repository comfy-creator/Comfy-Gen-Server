## ComfyTS

## The most powerful and modular stable diffusion GUI and backend.

![ComfyUI Screenshot](comfyui_screenshot.png)

ComfyTS ("Comfy-The-Sequel" / "Comfy-TypeScript") is a fork of ComfyUI. It serves as the backend for [void.tech](https://void.tech). Project goals:

- Fix issues with ComfyUI
- Adapt ComfyUI to work in a serverless, multi-user environment more easily
- Maintain compatability with the existing ComfyUI ecosystem of custom-nodes and workflows

### Docker Instructions:

<<<<<<< HEAD

- Start your docker daemon, then in the root folder run the build command:

  # `docker build -t voidtech0/comfy-ts:0.1.0 .`

- Start your docker daemon, or install Docker if you don't already have it.
- In the root of this repo, run the build command:

  `docker build -t voidtech0/comfy-ts:0.1.2 .`

  > > > > > > > build-test

Note that the docker-build does not copy any of the models into the docker-image, which would bloat the image-size. Instead, it expects to load the models from an external filesystem upon startup.

- `docker run -it --name (???) --gpus all -p 8188:8188 -v "$(pwd)"/storage:(???)`

### Headless ComfyTS

<<<<<<< HEAD

- https://hub.docker.com/r/yanwk/comfyui-boot
- https://hub.docker.com/r/universonic/stable-diffusion-webui
- https://hub.docker.com/r/ashleykza/stable-diffusion-webui
- # https://github.com/ai-dock/comfyui
- Run `docker build -f Dockerfile.headless -t voidtech0/comfy-ts:0.1.2-headless .` in order to build ComfyTS in headless mode; this will not build and copy over any UI-components, making for a smaller docker-image. This is useful when running ComfyTS purely as a backend API in a cloud-environment.
  > > > > > > > build-test

### Other ComfyUI docker images

Check these out as alternative builds if you don't like ComfyTS' build:

- https://hub.docker.com/r/yanwk/comfyui-boot
- https://hub.docker.com/r/universonic/stable-diffusion-webui
- https://hub.docker.com/r/ashleykza/stable-diffusion-webui
- https://github.com/ai-dock/comfyui

### Docker To Do:

- Make sure filesystem cache and sym-links are working.
- Do we really need the extra_model_paths?
- We probably won't need sym-links and extra-model paths anymore to be honest; we can build those into comfy-ts directly.
- Stop custom nodes from downloading external files and doing pip-install at runtime (on startup). We should ensure that's all done at build-time.
- NFS sym-links: all of ComfyUI's folders (/input, /output, /temp, /models) should be symlinked to an NFS drive, so that they can be shared amongst workers.

### General To Do:

- Add ComfyUI manager into this repo by default
- Add a startup flag to turn off the ComfyUI manager and other settings. (This is for when running ComfyTS in a cloud environment, where users downloading custom-nodes would be inappropriate.)
- Add a startup flag to switch between using ComfyUI-local or using the void-tech API

### Future

- We'll need to update the ui-tests, so that they work with importing Litegraph as a library rather than assuming it exists already in its execution context.

### Building the UI

`/web` is now a build-folder, built from `/web-src`. To recreate it, `cd` into /web-src, then run `yarn` to install dependencies, followed by `yarn build`.

(Should I include the `/web` build folder in this repo as well?)

You normally shouldn't commit build-folders to your repo, but in this case it makes it easier for end-users to just git-clone this repo and start working, without the need to install any javascript-package mangers on their machine.

### ComfyTS To Do:

- Get rid of the clipspace properties / methods being marked as static; consider making them instance-properties instead (since they read and modify the 'app' singleton object). This would require replacing `ComfyApp.clipspace` references with `app.clipspace` references instead.

- Consider making the extensions a static property of app; it might make sense to share them amongst instances of the app.

### Non-Commercial License

ComfyTS is released under a non-commercial license very similar to StabilityAI's SVD model license; ComfyTS is free for personal use, but not for commercial production. This balances our goals of being a profitable company at void.tech, while also allowing anyone to use our tools for free locally on their own computers.

If you'd be interested in licensing this commercially, message me at paul@fidika.com. If comfyanonymous, pythongosssss, or anyone building an opensource custom-node on ComfyUI wants to use anything in this repo, they're certainly welcome to without even asking. Thanks guys.

### List of Changes

- (everything changed from ComfyUI...)
