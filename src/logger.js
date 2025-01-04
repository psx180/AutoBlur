const winston = require('winston');
const {combine, cli, colorize, splat} = winston.format;
//import winston from 'winston';
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'verbose',
    format: combine(
        //  cli(),
        colorize({message:true, level: false}),
        splat()
    ),
    defaultMeta: { service: 'user-service' },
    transports: [
        //
        // - Write all logs with importance level of `error` or less to `error.log`
        // - Write all logs with importance level of `info` or less to `combined.log`
        //
        //new winston.transports.File({ filename: 'error.log', level: 'error' }),
        // new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: combine(
                cli(),
                colorize({message:true, level: false}),
                splat()
            )
        })
        //new winston.transports.File({ filename: 'blurrr.log'})
    ],
});

exports.logger = logger;
