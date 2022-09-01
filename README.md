![Logo](admin/fronius-wattpilot.png)
# ioBroker.fronius-wattpilot

[![NPM version](https://img.shields.io/npm/v/iobroker.fronius-wattpilot.svg)](https://www.npmjs.com/package/iobroker.fronius-wattpilot)
[![Downloads](https://img.shields.io/npm/dm/iobroker.fronius-wattpilot.svg)](https://www.npmjs.com/package/iobroker.fronius-wattpilot)
![Number of Installations](https://iobroker.live/badges/fronius-wattpilot-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/fronius-wattpilot-stable.svg)
[![Dependency Status](https://img.shields.io/david/tim2zg/iobroker.fronius-wattpilot.svg)](https://david-dm.org/tim2zg/iobroker.fronius-wattpilot)

[![NPM](https://nodei.co/npm/iobroker.fronius-wattpilot.png?downloads=true)](https://nodei.co/npm/iobroker.fronius-wattpilot/)

**Tests:** ![Test and Release](https://github.com/tim2zg/ioBroker.fronius-wattpilot/workflows/Test%20and%20Release/badge.svg)

Barebones implementation of the unofficial Fronius Watt pilot (https://www.fronius.com/de-ch/switzerland/solarenergie/installateure-partner/technische-daten/alle-produkte/l%C3%B6sungen/fronius-wattpilot) API. Based on https://github.com/joscha82/wattpilot.

## How to install:
Finish your normal installation in the Fronius Watt pilot app. Remember the Password! Then go to the Internet tap and connect your Pilot to your Wi-Fi. After the connection click again on the Wi-Fi name. You will see a page with more information about your Wi-Fi connection note the IP address down. You currently can install the adapter through the expert menu in your broker. After you create the instance, you will be prompted with a Password and IP address filed. Fill in the values you noted before and save the config. If you have done everything correctly the adapter will turn green after a while and you can see the incoming data in the objects tab.

I don't take the responsibility for your device. With this API you can access the device directly, be careful. 

## How can I use the adapter...
Here is an example that can measure your Solar Grid output and adjust the Pilot to the right Amp value.
It's a blockly script, you can simply import it:
```
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="on_ext" id="gq`,=3iU#9VNbFii.@c!" x="38" y="-137">
    <mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>
    <field name="CONDITION">any</field>
    <field name="ACK_CONDITION"></field>
    <value name="OID0">
      <shadow type="field_oid" id="()(Rz:ROjN?}V$rLe[hs">
        <field name="oid">fronius.0.powerflow.P_Grid</field>
      </shadow>
    </value>
    <statement name="STATEMENT">
      <block type="controls_if" id="LvwK}YD_{y*-5]}neG-d">
        <mutation elseif="4" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id=",wkwC#dURx7tHgqoDNiW">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="math_number" id="Y}7erw598VFI13%!Zq$=">
                <field name="NUM">-11000</field>
              </block>
            </value>
            <value name="B">
              <block type="get_value" id="T6w}PKP8X?ysp!#bhUjh">
                <field name="ATTR">val</field>
                <field name="OID">fronius.0.powerflow.P_Grid</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="controls_if" id="FMiO`]x/mB3M4nt#(e[0">
            <value name="IF0">
              <block type="logic_compare" id="Pk2fWtU+=|xuhRGxB]_l">
                <field name="OP">NEQ</field>
                <value name="A">
                  <block type="math_number" id="raI]cm:(X#l[;HX~I=G6">
                    <field name="NUM">16</field>
                  </block>
                </value>
                <value name="B">
                  <block type="get_value" id="29f^g,k_PNA(lLY=7s8D">
                    <field name="ATTR">val</field>
                    <field name="OID">fronius-wattpilot.1.amp</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="update" id="9_RqUWnr_=@1{![9mudX">
                <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                <field name="OID">fronius-wattpilot.1.set_power</field>
                <field name="WITH_DELAY">FALSE</field>
                <value name="VALUE">
                  <block type="math_number" id="z?#{zUZoS8Xc#0n6,d;f">
                    <field name="NUM">16</field>
                  </block>
                </value>
                <next>
                  <block type="update" id="lPB55x#gx^-@9?XlA:sI">
                    <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                    <field name="OID">fronius-wattpilot.1.set_state</field>
                    <field name="WITH_DELAY">FALSE</field>
                    <value name="VALUE">
                      <block type="text" id=".Ztm5r2#v-yKjk5ic?*=">
                        <field name="TEXT">frc;0</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
          </block>
        </statement>
        <value name="IF1">
          <block type="logic_compare" id="lFc0Dt[erzS#?*9m$Gs(">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="math_number" id="1-jcVD)^v`~FDO9P(`uD">
                <field name="NUM">-9700</field>
              </block>
            </value>
            <value name="B">
              <block type="get_value" id="M/.p;7R?aRg-k*Y7%DeG">
                <field name="ATTR">val</field>
                <field name="OID">fronius.0.powerflow.P_Grid</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO1">
          <block type="controls_if" id="voFOXP[5qijJD_Gd|CKY">
            <value name="IF0">
              <block type="logic_compare" id="(:]4!n||+S#e5^CB,NKb">
                <field name="OP">NEQ</field>
                <value name="A">
                  <block type="math_number" id="(20q$Yw~nD+_sm(=roKF">
                    <field name="NUM">14</field>
                  </block>
                </value>
                <value name="B">
                  <block type="get_value" id="b}@IzyQW.Eqw_{3;C$-m">
                    <field name="ATTR">val</field>
                    <field name="OID">fronius-wattpilot.1.amp</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="update" id="-/*2ZkD(0bg!SVkw|p9j">
                <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                <field name="OID">fronius-wattpilot.1.set_power</field>
                <field name="WITH_DELAY">FALSE</field>
                <value name="VALUE">
                  <block type="math_number" id="4mf+w8|dl_O0vEz~(0-i">
                    <field name="NUM">14</field>
                  </block>
                </value>
                <next>
                  <block type="update" id="9pw]QUM+#xC:E*hf}wtG">
                    <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                    <field name="OID">fronius-wattpilot.1.set_state</field>
                    <field name="WITH_DELAY">FALSE</field>
                    <value name="VALUE">
                      <block type="text" id="d8;a!I34q$|fO+Eoq){V">
                        <field name="TEXT">frc;0</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
          </block>
        </statement>
        <value name="IF2">
          <block type="logic_compare" id="%kVT5F^C~A4`SaV0(!1|">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="math_number" id="NkY,0Hu|rI^~qiAh14LO">
                <field name="NUM">-8300</field>
              </block>
            </value>
            <value name="B">
              <block type="get_value" id="U;.D5yAmCi0j^ZXw^4T@">
                <field name="ATTR">val</field>
                <field name="OID">fronius.0.powerflow.P_Grid</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO2">
          <block type="controls_if" id="PX%mkBufZ3p%BKK{_-`{">
            <value name="IF0">
              <block type="logic_compare" id="%)sw95037rf=T23ds,QB">
                <field name="OP">NEQ</field>
                <value name="A">
                  <block type="math_number" id="#G4-S^gKVI`[Tx)ZW^0p">
                    <field name="NUM">12</field>
                  </block>
                </value>
                <value name="B">
                  <block type="get_value" id="`~o.{;rr/ixUw,Y{HJM@">
                    <field name="ATTR">val</field>
                    <field name="OID">fronius-wattpilot.1.amp</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="update" id="duFC]#$DhGEt_Gl?}@m]">
                <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                <field name="OID">fronius-wattpilot.1.set_power</field>
                <field name="WITH_DELAY">FALSE</field>
                <value name="VALUE">
                  <block type="math_number" id="xy?ElpZB%P6IGkkEHkkD">
                    <field name="NUM">12</field>
                  </block>
                </value>
                <next>
                  <block type="update" id="W$pgC,-c!Wue?wf:K4oq">
                    <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                    <field name="OID">fronius-wattpilot.1.set_state</field>
                    <field name="WITH_DELAY">FALSE</field>
                    <value name="VALUE">
                      <block type="text" id="996E=7etPOU+|p+hA7cA">
                        <field name="TEXT">frc;0</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
          </block>
        </statement>
        <value name="IF3">
          <block type="logic_compare" id="ys`0.^2jSxZ*=JlZe@3(">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="math_number" id="2@HDCKb{.p`7:Q;z=R!U">
                <field name="NUM">-6900</field>
              </block>
            </value>
            <value name="B">
              <block type="get_value" id=";HMOdIs6yqeJAky#8_*w">
                <field name="ATTR">val</field>
                <field name="OID">fronius.0.powerflow.P_Grid</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO3">
          <block type="controls_if" id="?;b2NX9MotHOvX:ZWlxw">
            <value name="IF0">
              <block type="logic_compare" id="f:#4LU/k_g}I/D4wz4Hi">
                <field name="OP">NEQ</field>
                <value name="A">
                  <block type="math_number" id="v)tlc1tgctdw_|A8SdMv">
                    <field name="NUM">10</field>
                  </block>
                </value>
                <value name="B">
                  <block type="get_value" id="AFI_(]8!=]7ah~aL0n1H">
                    <field name="ATTR">val</field>
                    <field name="OID">fronius-wattpilot.1.amp</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="update" id="T7y|u!v-x3N/:_)9vmoA">
                <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                <field name="OID">fronius-wattpilot.1.set_power</field>
                <field name="WITH_DELAY">FALSE</field>
                <value name="VALUE">
                  <block type="math_number" id="]IJS/6Y.{`rpi)1/QiQE">
                    <field name="NUM">10</field>
                  </block>
                </value>
                <next>
                  <block type="update" id="LHV];txC;wm~bzSi5G|L">
                    <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                    <field name="OID">fronius-wattpilot.1.set_state</field>
                    <field name="WITH_DELAY">FALSE</field>
                    <value name="VALUE">
                      <block type="text" id="cY4)47PzF_8YFIW**FN6">
                        <field name="TEXT">frc;0</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
          </block>
        </statement>
        <value name="IF4">
          <block type="logic_compare" id="9oDDifoGa:x8ydabNrmN">
            <field name="OP">GT</field>
            <value name="A">
              <block type="math_number" id="fT[FFamnz%+XVjmC[2V)">
                <field name="NUM">-4100</field>
              </block>
            </value>
            <value name="B">
              <block type="get_value" id="CiVLqdWl0lV3c|`1q=],">
                <field name="ATTR">val</field>
                <field name="OID">fronius.0.powerflow.P_Grid</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO4">
          <block type="controls_if" id="5W`0S^!QK-3WlI;?FoX4">
            <value name="IF0">
              <block type="logic_operation" id="AIsyWmQ)uA#=g4WnHcn`">
                <field name="OP">AND</field>
                <value name="A">
                  <block type="logic_compare" id="Y7O]^!-@xtcOA~k}GJ(R">
                    <field name="OP">NEQ</field>
                    <value name="A">
                      <block type="math_number" id="?(Wt=gR_xI2zlk)M]%9!">
                        <field name="NUM">6</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="get_value" id="Ru$(aZP.pT{yRtIu`n+F">
                        <field name="ATTR">val</field>
                        <field name="OID">fronius-wattpilot.1.amp</field>
                      </block>
                    </value>
                  </block>
                </value>
                <value name="B">
                  <block type="logic_compare" id="Tzp$9ht,g]zQBH4i${[)">
                    <field name="OP">NEQ</field>
                    <value name="A">
                      <block type="text" id=",#yVKehj)C1Hs@MH:n1c">
                        <field name="TEXT">frc;0</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="get_value" id="o-FMmY;.d.PnU|U{Q[1B">
                        <field name="ATTR">val</field>
                        <field name="OID">fronius-wattpilot.1.set_state</field>
                      </block>
                    </value>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="update" id="Pq4D;`-+~59WItT;R2Hu">
                <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                <field name="OID">fronius-wattpilot.1.set_power</field>
                <field name="WITH_DELAY">FALSE</field>
                <value name="VALUE">
                  <block type="math_number" id="QG4v;AI=eRz9-*Pp{!@D">
                    <field name="NUM">6</field>
                  </block>
                </value>
                <next>
                  <block type="update" id="t-ehj(=?=~t29v+YZ$?w">
                    <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                    <field name="OID">fronius-wattpilot.1.set_state</field>
                    <field name="WITH_DELAY">FALSE</field>
                    <value name="VALUE">
                      <block type="text" id="_/~G~5kCfCsl2hT;,y[a">
                        <field name="TEXT">frc;0</field>
                      </block>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="0~%Q9}4p*x{{fmmzk{h+">
            <value name="IF0">
              <block type="logic_compare" id="MU4F,SOLWXAV;;L^|kOR">
                <field name="OP">NEQ</field>
                <value name="A">
                  <block type="text" id="mj{z|;#HBW:2Rz;kjmA+">
                    <field name="TEXT">frc;1</field>
                  </block>
                </value>
                <value name="B">
                  <block type="get_value" id="@^^G[^DU7NX]3-M0H7j7">
                    <field name="ATTR">val</field>
                    <field name="OID">fronius-wattpilot.1.set_state</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="update" id="(T(ocBtXi|gHGA8W@q;U">
                <mutation xmlns="http://www.w3.org/1999/xhtml" delay_input="false"></mutation>
                <field name="OID">fronius-wattpilot.1.set_state</field>
                <field name="WITH_DELAY">FALSE</field>
                <value name="VALUE">
                  <block type="text" id="Rx:+[nc`je/J?jUq`C}F">
                    <field name="TEXT">frc;1</field>
                  </block>
                </value>
              </block>
            </statement>
          </block>
        </statement>
      </block>
    </statement>
  </block>
</xml>
```

## What does the parser?
Parser only writes the key points of the Wattpilot. If you want all the values, you can disable it. A documentation of the Datapoints is available here: https://github.com/joscha82/wattpilot/blob/main/API.md (Tanks to joscha82)

## Set states?
Yes, just write the State name than a semicolon and then the value in the set_state state.
You can control the amp and the lmo stat directly via the set_power and the set_mode states.

## What does this mess mean?
Thanks to joscha82 we know: https://github.com/joscha82/wattpilot/blob/main/API.md


### Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ## **WORK IN PROGRESS**
-->
### 2.2.4 (2022-09-01)
- SebastianHanz fixed infinite RAM-usage
- added some description

### 2.2.3 (2022-08-30)
- SebastianHanz fixed type-conflicts. Thank you!

### 2.2.2 (2022-08-25)
- Bug fixes

### 2.2.1 (2022-08-22)
- Bug fixes

### 2.2.0 (2022-08-21)
- Fixed Bugs

### 2.1.0 (2022-08-19)
- Min Node Version 16

### 2.0.3 (2022-07-20)
- Updated Readme

### 2.0.2 (2022-07-12)
-   Bug fixed

### 2.0.1 (2022-07-10)
-   Added a how to install. Not to detail because currently not in stable repo.

### 2.0.0 (2022-07-10)
-   Fixed NPM Versions hopefully

### 1.1.0 (2022-07-10)
-   Added UselessPV and TimeStamp Parser, did some testing.

### 1.0.1 (2022-06-02)
-Tests

### 1.0.0 (2022-06-02)

- Did some changes
- Did some more changes

## v0.0.5 (2020-01-01)
Better Code

## v0.0.4 (2020-01-01)
Parser option added

## v0.0.3 (2020-01-01)
Parser added

## v0.0.2 (2020-01-01)
Bug fixed

## v0.0.1 (2020-01-01)
Initial release


## License
MIT License

Copyright (c) 2022 tim2zg <tim2zg@protonmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.