declare module 'nodemailer-sendgrid-transport' {
  import { TransportOptions } from 'nodemailer'

  interface SendGridTransportOptions {
    auth: {
      api_key: string
    }
  }

  function sendgridTransport(options: SendGridTransportOptions): TransportOptions
  export = sendgridTransport
} 