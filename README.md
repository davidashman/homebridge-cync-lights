# Homebridge Cync by GE Plugin

This plugin integrates the Cync Direct Connect light bulbs from GE with Homekit.  These bulbs are very high quality and tolerate
the variations in voltage from power sources much better than many other bulbs on the market.  But GE has abandoned it's 
support for Homekit in it's Cync products.

## Configuration

Configuring this plugin requires running a script that is included to generate the keys needed.  Since Cync requires 
2FA, the process needs to be done outside of Homebridge for now.  From the Homebridge terminal:

```shell
> cd node_modules/homebridge-cync-lights
> bin/authenticate <Cync email address>
```

You will be prompted to look at your email for a 2FA code.
```shell
> bin/authenticate <Cync email address> <Cync password> <2FA code>
```

The results returned will include three items needed for configuration:
- `user_id` - Your Cync user ID
- `refresh_token` - The OAuth refresh token required for accessing metadata about your devices
- `authorize` - The authorization token for your user to connect with the Cync servers

Note that you may need to restart Homebridge a couple times after configuration to ensure connections are made properly.