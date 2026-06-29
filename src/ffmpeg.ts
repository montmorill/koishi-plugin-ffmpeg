import { Context, Service } from 'koishi'
import { spawn } from 'child_process'
import { Readable } from 'stream'

declare module 'koishi' {
  interface Context {
    ffmpeg: FFmpeg
  }
}

interface RunReturn {
  file: Promise<void>
  buffer: Promise<Buffer>
  info: Promise<Buffer>
  stream: Readable
}

export interface Config {
  executable: string
  debug: boolean
}

export class FFmpegBuilder {
  _input: string | Buffer | Readable | undefined
  inputOptions: string[] = []
  outputOptions: string[] = []
  constructor(public config: Config) {}

  input(path: string): FFmpegBuilder
  input(buffer: Buffer): FFmpegBuilder
  input(stream: Readable): FFmpegBuilder
  input(arg: string | Buffer | Readable): FFmpegBuilder {
    this._input = arg
    return this
  }

  inputOption(...option: string[]): FFmpegBuilder {
    this.inputOptions.push(...option)
    return this
  }

  outputOption(...option: string[]): FFmpegBuilder {
    this.outputOptions.push(...option)
    return this
  }

  run<T extends keyof RunReturn>(type: T, path?: string): RunReturn[T] {
    const options: string[] = ['-y']
    if (typeof this._input === 'string') {
      options.push(...[...this.inputOptions, '-i', this._input])
    } else {
      options.push(...[...this.inputOptions, '-i', '-'])
    }
    if (type === 'file') {
      options.push(...[...this.outputOptions, path!])
    } else if (type !== 'info') {
      options.push(...[...this.outputOptions, '-'])
    }
    console.log(options)
    const child = spawn(this.config.executable, options, { stdio: 'pipe' })
    if (this._input instanceof Buffer) {
      child.stdin.write(this._input)
      child.stdin.end()
    } else if (this._input instanceof Readable) {
      this._input.pipe(child.stdin)
    }
    // TODO: pipe stderr to logger
    // https://github.com/shigma/reggol/issues/7
    if (type === 'stream') {
      return child.stdout as any
    } else {
      return new Promise<void | Buffer>((resolve, reject) => {
        child.stdin.on('error', function (err: any) {
          if (!['ECONNRESET', 'EPIPE', 'EOF'].includes(err.code)) reject(err)
        })
        if (this.config.debug) {
          child.stdout.on('data', data => console.log(data.toString()))
          child.stderr.on('data', data => console.error(data.toString()))
        }
        child.on('error', reject)
        let stream: Readable | undefined
        if (type === 'file') {
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`exited with ${code}`)))
        } else if (type === 'buffer') {
          stream = child.stdout
        } else if (type === 'info') {
          stream = child.stderr
        }
        if (stream) {
          const buffer: Buffer[] = []
          stream.on('data', data => buffer.push(data))
          stream.on('end', () => resolve(Buffer.concat(buffer)))
          stream.on('error', reject)
        }
      }) as any
    }
  }
}

export class FFmpeg extends Service {
  constructor(ctx: Context, public config: Config) {
    super(ctx, 'ffmpeg')
  }

  builder() {
    return new FFmpegBuilder(this.config)
  }
}
